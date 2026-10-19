import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { HouseholdMealShoppingApprovalInput } from '../schemas/household-meal-shopping-approval.schema.js';
import { readActiveHouseholdId } from './household-context.js';
import { normalizeIngredientMatchKey } from './ingredient-match.js';
import { productKeyOf } from './product-key.js';
import {
  householdMealShoppingPreviewId,
  readHouseholdMealShoppingPreview
} from './household-meal-shopping-preview.store.js';

type SqliteDb = import('better-sqlite3').Database;

type PendingShoppingItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  product_key: string;
  checked: number;
};

export interface ApproveHouseholdMealShoppingOptions {
  householdId: string;
  userId: string;
  input: HouseholdMealShoppingApprovalInput;
  today?: string;
}

export interface ApproveHouseholdMealShoppingResult {
  listId: string | null;
  version: number | null;
  created: boolean;
  changed: boolean;
  added: number;
  updated: number;
  removed: number;
}

export type HouseholdMealShoppingApprovalErrorCode =
  'HOUSEHOLD_CONTEXT_CHANGED' | 'MEAL_SHOPPING_PREVIEW_STALE' | 'MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW';

export class HouseholdMealShoppingApprovalError extends Error {
  constructor(readonly code: HouseholdMealShoppingApprovalErrorCode) {
    super(code);
    this.name = 'HouseholdMealShoppingApprovalError';
  }
}

/**
 * Recomputes the read-only preview and reconciles only pending meal-plan rows. The enclosing
 * synchronous SQLite transaction makes the fingerprint check and list update one atomic action.
 */
export function approveHouseholdMealShopping(
  db: SqliteDb,
  options: ApproveHouseholdMealShoppingOptions
): ApproveHouseholdMealShoppingResult {
  return db.transaction(() => {
    if (readActiveHouseholdId(db, options.userId) !== options.householdId) {
      throw new HouseholdMealShoppingApprovalError('HOUSEHOLD_CONTEXT_CHANGED');
    }

    const { input, householdId, userId } = options;
    const preview = readHouseholdMealShoppingPreview(
      db,
      householdId,
      { startDate: input.startDate, endDate: input.endDate },
      options.today
    );
    if (householdMealShoppingPreviewId(householdId, preview) !== input.previewId) {
      throw new HouseholdMealShoppingApprovalError('MEAL_SHOPPING_PREVIEW_STALE');
    }

    const eligible = new Set(
      [...preview.requiredIngredients, ...preview.optionalIngredients]
        .filter(
          (ingredient) =>
            (ingredient.status === 'not_found' || ingredient.status === 'matched') &&
            ingredient.missingQuantity !== null &&
            ingredient.missingQuantity > 0
        )
        .map(ingredientKey)
    );
    const requested = new Map<string, (typeof input.items)[number]>();
    for (const item of input.items) {
      const key = ingredientKey(item);
      if (!eligible.has(key) || requested.has(key)) {
        throw new HouseholdMealShoppingApprovalError('MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW');
      }
      requested.set(key, item);
    }

    const requestHash = approvalRequestHash(input);
    const priorApproval = db
      .prepare(
        `SELECT list_id, version FROM household_meal_shopping_approvals
         WHERE household_id = ? AND preview_id = ? AND request_hash = ?`
      )
      .get(householdId, input.previewId, requestHash) as
      { list_id: string | null; version: number | null } | undefined;
    if (priorApproval) {
      return {
        listId: priorApproval.list_id,
        version: priorApproval.version,
        created: false,
        changed: false,
        added: 0,
        updated: 0,
        removed: 0
      };
    }

    let list = db
      .prepare(
        `SELECT id, version FROM shopping_lists
         WHERE household_id = ? AND source = 'meal_plan' AND status = 'active'
         ORDER BY updated_at DESC, id ASC LIMIT 1`
      )
      .get(householdId) as { id: string; version: number } | undefined;
    let created = false;
    if (!list) {
      const listId = nanoid();
      db.prepare(
        `INSERT INTO shopping_lists (id, user_id, household_id, name, source)
         VALUES (?, ?, ?, 'Plan de comidas', 'meal_plan')`
      ).run(listId, userId, householdId);
      list = { id: listId, version: 1 };
      created = true;
    }

    const activeItems = db
      .prepare(
        `SELECT id, name, quantity, unit, product_key, checked
         FROM shopping_list_items
         WHERE list_id = ? AND source = 'meal_plan' AND checked = 0 AND deleted_at IS NULL
         ORDER BY position, id`
      )
      .all(list.id) as PendingShoppingItem[];
    const activeByKey = new Map<string, PendingShoppingItem[]>();
    for (const item of activeItems) {
      const key = ingredientKey(item);
      activeByKey.set(key, [...(activeByKey.get(key) ?? []), item]);
    }

    let added = 0;
    let updated = 0;
    let removed = 0;
    const retained = new Set<string>();
    for (const [key, requestedItem] of requested) {
      const existing = activeByKey.get(key)?.[0];
      if (!existing) {
        insertMealPlanItem(db, list.id, requestedItem, userId);
        added += 1;
        continue;
      }
      retained.add(existing.id);
      if (existing.quantity !== requestedItem.quantity) {
        db.prepare(
          `UPDATE shopping_list_items
           SET quantity = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
           WHERE id = ? AND list_id = ? AND source = 'meal_plan' AND checked = 0 AND deleted_at IS NULL`
        ).run(requestedItem.quantity, userId, existing.id, list.id);
        updated += 1;
      }
      for (const duplicate of activeByKey.get(key)?.slice(1) ?? []) {
        softDeleteMealPlanItem(db, list.id, duplicate.id, userId);
        removed += 1;
      }
    }

    for (const item of activeItems) {
      if (retained.has(item.id) || requested.has(ingredientKey(item))) continue;
      softDeleteMealPlanItem(db, list.id, item.id, userId);
      removed += 1;
    }

    const changed = created || added > 0 || updated > 0 || removed > 0;
    if (changed && !created) {
      db.prepare(
        `UPDATE shopping_lists
         SET version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by = ?
         WHERE id = ? AND household_id = ? AND source = 'meal_plan' AND status = 'active'`
      ).run(userId, list.id, householdId);
      list.version += 1;
    }

    db.prepare(
      `INSERT INTO household_meal_shopping_approvals
         (household_id, preview_id, request_hash, list_id, version)
       VALUES (?, ?, ?, ?, ?)`
    ).run(householdId, input.previewId, requestHash, list.id, list.version);

    return {
      listId: list.id,
      version: list.version,
      created,
      changed,
      added,
      updated,
      removed
    };
  })();
}

function ingredientKey(value: { name: string; unit: string | null }): string {
  return JSON.stringify([normalizeIngredientMatchKey(value.name), value.unit]);
}

function approvalRequestHash(input: HouseholdMealShoppingApprovalInput): string {
  const items = input.items
    .map((item) => ({ key: ingredientKey(item), quantity: item.quantity }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return createHash('sha256')
    .update(
      JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        previewId: input.previewId,
        items
      })
    )
    .digest('hex');
}

function insertMealPlanItem(
  db: SqliteDb,
  listId: string,
  input: { name: string; unit: string; quantity: number },
  userId: string
): void {
  const nextPosition = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shopping_list_items WHERE list_id = ?'
    )
    .get(listId) as { position: number };
  db.prepare(
    `INSERT INTO shopping_list_items
       (id, list_id, name, product_key, quantity, unit, position, added_by, updated_by, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'meal_plan')`
  ).run(
    nanoid(),
    listId,
    input.name,
    productKeyOf(input.name),
    input.quantity,
    input.unit,
    nextPosition.position,
    userId,
    userId
  );
}

function softDeleteMealPlanItem(
  db: SqliteDb,
  listId: string,
  itemId: string,
  userId: string
): void {
  db.prepare(
    `UPDATE shopping_list_items
     SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by = ?
     WHERE id = ? AND list_id = ? AND source = 'meal_plan' AND checked = 0 AND deleted_at IS NULL`
  ).run(userId, itemId, listId);
}
