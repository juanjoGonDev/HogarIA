import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { householdMealConsumptionSchema } from '../schemas/household-meal-consumption.schema.js';
import { activeHouseholdId } from './household-context.js';

type SqliteDb = import('better-sqlite3').Database;
type ConsumptionStatus = 'realized' | 'not_realized';
type SnapshotIngredient = { name: string; quantity: number; unit: string; isOptional?: boolean };
type ParsedSnapshot = { ingredients: SnapshotIngredient[]; hash: string };

const EPSILON = 1e-9;
const storedSnapshotSchema = z.object({
  baseServings: z.literal(1),
  ingredients: z.array(
    z.object({
      name: z.string().trim().min(1).max(200),
      quantity: z.number().finite().positive(),
      unit: z.string().trim().min(1).max(40),
      isOptional: z.boolean().optional()
    })
  )
});
const storedSnapshotHash = (ingredients: SnapshotIngredient[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        ingredients.map((ingredient) => [
          ingredient.name,
          ingredient.quantity,
          ingredient.unit,
          ingredient.isOptional === true
        ])
      )
    )
    .digest('hex');

export type MealConsumptionWarning = {
  code:
    | 'RECIPE_SNAPSHOT_UNAVAILABLE'
    | 'HOUSEHOLD_PANTRY_NOT_SHARED'
    | 'INGREDIENT_UNMATCHED'
    | 'INGREDIENT_AMBIGUOUS'
    | 'INSUFFICIENT_STOCK'
    | 'STOCK_RESTORE_UNAVAILABLE';
  ingredientName?: string;
  unit?: string;
  requestedQuantity?: number;
  deductedQuantity?: number;
  reason?: 'not_found' | 'unit_mismatch' | 'ambiguous';
};

export type MealConsumptionRecord = {
  mealId: string;
  status: 'unrecorded' | ConsumptionStatus;
  servings: number | null;
  version: number;
  idempotent?: boolean;
  warnings: MealConsumptionWarning[];
};

export class MealConsumptionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'FORBIDDEN'
      | 'CALENDAR_VIEW_REQUIRED'
      | 'PARTICIPANT_REQUIRED'
      | 'NOT_FOUND'
      | 'HOUSEHOLD_CONTEXT_CHANGED'
      | 'VERSION_CONFLICT'
      | 'INVENTORY_UNIT_CHANGED'
      | 'RECIPE_SNAPSHOT_UNAVAILABLE',
    message: string
  ) {
    super(message);
    this.name = 'MealConsumptionError';
  }
}

type RecordInput = {
  mealId: string;
  expectedHouseholdId: string;
} & z.infer<typeof householdMealConsumptionSchema>;

type MealRow = {
  id: string;
  household_id: string;
  recipe_snapshot: string | null;
  shared_pantry: number | null;
};

type CurrentConsumptionRow = {
  status: ConsumptionStatus;
  servings: number;
  version: number;
  warnings_json: string;
  recipe_snapshot_hash: string | null;
};

type DeductionRow = {
  line_index: number;
  ingredient_id: string | null;
  ingredient_name: string;
  unit: string;
  target_quantity: number;
  deducted_quantity: number;
};

type IngredientRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  household_id: string;
};

function invalid(message: string): never {
  throw new MealConsumptionError('INVALID_INPUT', message);
}

function memberCanViewCalendar(db: SqliteDb, householdId: string, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT permissions FROM household_members
       WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, userId) as { permissions: string | null } | undefined;
  if (!row?.permissions) return false;
  try {
    const permissions: unknown = JSON.parse(row.permissions);
    if (!permissions || typeof permissions !== 'object') return false;
    const calendar = (permissions as Record<string, unknown>).calendar;
    return Boolean(
      calendar &&
      typeof calendar === 'object' &&
      (calendar as Record<string, unknown>).view === true
    );
  } catch {
    return false;
  }
}

function assertAuthorizedMeal(
  db: SqliteDb,
  actorId: string,
  mealId: string,
  expectedHouseholdId: string
): MealRow {
  const activeId = activeHouseholdId(db, actorId);
  if (activeId !== expectedHouseholdId) {
    throw new MealConsumptionError(
      'HOUSEHOLD_CONTEXT_CHANGED',
      'El hogar activo cambió durante el registro de la comida'
    );
  }
  if (!memberCanViewCalendar(db, expectedHouseholdId, actorId)) {
    throw new MealConsumptionError('CALENDAR_VIEW_REQUIRED', 'Se requiere permiso calendar.view');
  }

  const meal = db
    .prepare(
      `SELECT m.id, m.recipe_snapshot, wc.household_id, h.shared_pantry
       FROM meals m
       JOIN weekly_calendars wc ON wc.id = m.calendar_id
       JOIN households h ON h.id = wc.household_id
       WHERE m.id = ? AND m.source_proposal_id IS NOT NULL AND wc.household_id = ?`
    )
    .get(mealId, expectedHouseholdId) as MealRow | undefined;
  if (!meal) {
    throw new MealConsumptionError('NOT_FOUND', 'La comida compartida no existe');
  }

  const isParticipant = db
    .prepare('SELECT 1 FROM meal_participants WHERE meal_id = ? AND user_id = ?')
    .get(mealId, actorId);
  if (!isParticipant) {
    throw new MealConsumptionError(
      'PARTICIPANT_REQUIRED',
      'La comida no está asignada a este participante'
    );
  }
  return meal;
}

function readStoredWarnings(raw: string | null | undefined): MealConsumptionWarning[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as MealConsumptionWarning[]) : [];
  } catch {
    return [];
  }
}

function readCurrent(db: SqliteDb, mealId: string): CurrentConsumptionRow | undefined {
  return db
    .prepare(
      `SELECT status, servings, version, warnings_json, recipe_snapshot_hash
       FROM meal_consumptions WHERE meal_id = ?`
    )
    .get(mealId) as CurrentConsumptionRow | undefined;
}

function readDeductions(db: SqliteDb, mealId: string): DeductionRow[] {
  return db
    .prepare(
      `SELECT line_index, ingredient_id, ingredient_name, unit, target_quantity, deducted_quantity
       FROM meal_consumption_deductions WHERE meal_id = ? ORDER BY line_index`
    )
    .all(mealId) as DeductionRow[];
}

function parseSnapshot(raw: string | null): ParsedSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = storedSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { ingredients: parsed.data.ingredients, hash: storedSnapshotHash(parsed.data.ingredients) }
      : null;
  } catch {
    return null;
  }
}

function normalizeMatchKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function listHouseholdIngredients(db: SqliteDb, householdId: string): IngredientRow[] {
  return db
    .prepare(
      `SELECT id, name, quantity, unit, household_id FROM ingredients
       WHERE household_id = ? ORDER BY id`
    )
    .all(householdId) as IngredientRow[];
}

function findExactIngredient(
  ingredients: IngredientRow[],
  name: string,
  unit: string
): { match?: IngredientRow; warning?: MealConsumptionWarning } {
  const normalizedName = normalizeMatchKey(name);
  const named = ingredients.filter(
    (ingredient) => normalizeMatchKey(ingredient.name) === normalizedName
  );
  const exact = named.filter(
    (ingredient) => normalizeMatchKey(ingredient.unit) === normalizeMatchKey(unit)
  );
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) {
    return {
      warning: { code: 'INGREDIENT_AMBIGUOUS', ingredientName: name, unit, reason: 'ambiguous' }
    };
  }
  return {
    warning: {
      code: 'INGREDIENT_UNMATCHED',
      ingredientName: name,
      unit,
      reason: named.length ? 'unit_mismatch' : 'not_found'
    }
  };
}

function ingredientById(db: SqliteDb, householdId: string, id: string): IngredientRow | undefined {
  return db
    .prepare(
      `SELECT id, name, quantity, unit, household_id FROM ingredients
       WHERE id = ? AND household_id = ?`
    )
    .get(id, householdId) as IngredientRow | undefined;
}

function applyStockDelta(
  db: SqliteDb,
  mealId: string,
  version: number,
  lineIndex: number,
  ingredient: IngredientRow,
  name: string,
  unit: string,
  previousDeducted: number,
  target: number,
  sharedPantry: number | null
): { deducted: number; warning?: MealConsumptionWarning } {
  const delta = target - previousDeducted;
  const latest = ingredientById(db, ingredient.household_id, ingredient.id);
  if (!latest) {
    return {
      deducted: previousDeducted,
      warning: {
        code: previousDeducted > EPSILON ? 'STOCK_RESTORE_UNAVAILABLE' : 'INGREDIENT_UNMATCHED',
        ingredientName: name,
        unit,
        reason: 'not_found'
      }
    };
  }
  if (normalizeMatchKey(latest.unit) !== normalizeMatchKey(unit)) {
    throw new MealConsumptionError(
      'INVENTORY_UNIT_CHANGED',
      'La unidad del producto cambió; no se puede corregir este consumo con seguridad'
    );
  }
  if (Math.abs(delta) < EPSILON) return { deducted: previousDeducted };

  if (delta < 0) {
    const restore = -delta;
    const changed = db
      .prepare(
        `UPDATE ingredients SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND household_id = ?`
      )
      .run(restore, latest.id, latest.household_id);
    if (changed.changes !== 1) {
      throw new MealConsumptionError(
        'VERSION_CONFLICT',
        'El inventario cambió; vuelve a intentarlo'
      );
    }
    addMovement(db, mealId, version, lineIndex, latest.id, name, unit, restore);
    return { deducted: target };
  }

  if (sharedPantry !== 1) {
    return {
      deducted: previousDeducted,
      warning: { code: 'HOUSEHOLD_PANTRY_NOT_SHARED', ingredientName: name, unit }
    };
  }

  const available = Number.isFinite(latest.quantity) ? Math.max(0, latest.quantity) : 0;
  const applied = Math.min(delta, available);
  if (applied > EPSILON) {
    const changed = db
      .prepare(
        `UPDATE ingredients SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND quantity >= ? AND household_id = ?`
      )
      .run(applied, latest.id, applied, latest.household_id);
    if (changed.changes !== 1) {
      throw new MealConsumptionError(
        'VERSION_CONFLICT',
        'El inventario cambió; vuelve a intentarlo'
      );
    }
    addMovement(db, mealId, version, lineIndex, latest.id, name, unit, -applied);
  }
  const deducted = previousDeducted + applied;
  if (deducted + EPSILON < target) {
    return {
      deducted,
      warning: {
        code: 'INSUFFICIENT_STOCK',
        ingredientName: name,
        unit,
        requestedQuantity: target,
        deductedQuantity: deducted
      }
    };
  }
  return { deducted };
}

function addMovement(
  db: SqliteDb,
  mealId: string,
  version: number,
  lineIndex: number,
  ingredientId: string,
  name: string,
  unit: string,
  delta: number
): void {
  db.prepare(
    `INSERT INTO meal_inventory_movements
      (id, meal_id, consumption_version, line_index, ingredient_id, ingredient_name, unit, delta_quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(), mealId, version, lineIndex, ingredientId, name, unit, delta);
}

function reconcileDeductions(
  db: SqliteDb,
  meal: MealRow,
  mealId: string,
  version: number,
  status: ConsumptionStatus,
  servings: number,
  snapshotIngredients: SnapshotIngredient[] | null,
  previousRows: DeductionRow[]
): { warnings: MealConsumptionWarning[]; deductions: DeductionRow[] } {
  const warnings: MealConsumptionWarning[] = [];
  const previous = new Map(previousRows.map((row) => [row.line_index, row]));
  const ingredients = listHouseholdIngredients(db, meal.household_id);
  const lines =
    snapshotIngredients ??
    previousRows.map((row) => ({
      name: row.ingredient_name,
      unit: row.unit,
      quantity: 0
    }));
  const next: DeductionRow[] = [];
  const seenIndices = new Set<number>();

  for (const [lineIndex, line] of lines.entries()) {
    seenIndices.add(lineIndex);
    const prior = previous.get(lineIndex);
    const isOptional = 'isOptional' in line && line.isOptional === true;
    const target = status === 'realized' && !isOptional ? line.quantity * servings : 0;
    let ingredientId = prior?.ingredient_id ?? null;
    let selected: IngredientRow | undefined = ingredientId
      ? ingredientById(db, meal.household_id, ingredientId)
      : undefined;
    let deducted = prior?.deducted_quantity ?? 0;

    if (!ingredientId && target > 0 && deducted <= EPSILON && meal.shared_pantry === 1) {
      const resolution = findExactIngredient(ingredients, line.name, line.unit);
      selected = resolution.match;
      ingredientId = selected?.id ?? null;
      if (resolution.warning) warnings.push(resolution.warning);
    } else if (!ingredientId && target > 0 && meal.shared_pantry !== 1) {
      warnings.push({
        code: 'HOUSEHOLD_PANTRY_NOT_SHARED',
        ingredientName: line.name,
        unit: line.unit
      });
    }

    if (ingredientId && !selected) {
      if (Math.abs(target - deducted) > EPSILON) {
        warnings.push({
          code: target < deducted ? 'STOCK_RESTORE_UNAVAILABLE' : 'INGREDIENT_UNMATCHED',
          ingredientName: line.name,
          unit: line.unit,
          ...(target > deducted ? { reason: 'not_found' as const } : {})
        });
      }
    } else if (!ingredientId && deducted > EPSILON && Math.abs(target - deducted) > EPSILON) {
      warnings.push({
        code: target < deducted ? 'STOCK_RESTORE_UNAVAILABLE' : 'INGREDIENT_UNMATCHED',
        ingredientName: line.name,
        unit: line.unit,
        ...(target > deducted ? { reason: 'not_found' as const } : {})
      });
    } else if (selected) {
      const applied = applyStockDelta(
        db,
        mealId,
        version,
        lineIndex,
        selected,
        line.name,
        line.unit,
        deducted,
        target,
        meal.shared_pantry
      );
      deducted = applied.deducted;
      if (applied.warning) warnings.push(applied.warning);
    }

    next.push({
      line_index: lineIndex,
      ingredient_id: selected ? ingredientId : null,
      ingredient_name: line.name,
      unit: line.unit,
      target_quantity: target,
      deducted_quantity: deducted
    });
  }

  // If a stored recipe was edited/corrupted since this consumption was recorded, restore any
  // removed lines before dropping their current ledger row.
  for (const prior of previousRows) {
    if (seenIndices.has(prior.line_index)) continue;
    if (prior.deducted_quantity <= EPSILON) continue;
    const selected = prior.ingredient_id
      ? ingredientById(db, meal.household_id, prior.ingredient_id)
      : undefined;
    if (!selected) {
      warnings.push({
        code: 'STOCK_RESTORE_UNAVAILABLE',
        ingredientName: prior.ingredient_name,
        unit: prior.unit
      });
      continue;
    }
    const restored = applyStockDelta(
      db,
      mealId,
      version,
      prior.line_index,
      selected,
      prior.ingredient_name,
      prior.unit,
      prior.deducted_quantity,
      0,
      meal.shared_pantry
    );
    if (restored.warning) warnings.push(restored.warning);
  }

  db.prepare('DELETE FROM meal_consumption_deductions WHERE meal_id = ?').run(mealId);
  const insert = db.prepare(
    `INSERT INTO meal_consumption_deductions
      (meal_id, line_index, ingredient_id, ingredient_name, unit, target_quantity, deducted_quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of next) {
    insert.run(
      mealId,
      row.line_index,
      row.ingredient_id,
      row.ingredient_name,
      row.unit,
      row.target_quantity,
      row.deducted_quantity
    );
  }
  return { warnings, deductions: next };
}

export function readSharedMealConsumption(
  db: SqliteDb,
  actorId: string,
  mealId: string,
  expectedHouseholdId: string
): MealConsumptionRecord {
  if (!mealId.trim() || mealId.length > 120 || !expectedHouseholdId.trim()) {
    return invalid('mealId u hogar inválido');
  }
  assertAuthorizedMeal(db, actorId, mealId, expectedHouseholdId);
  const current = readCurrent(db, mealId);
  return {
    mealId,
    status: current?.status ?? 'unrecorded',
    servings: current?.servings ?? null,
    version: current?.version ?? 0,
    warnings: readStoredWarnings(current?.warnings_json)
  };
}

export function recordSharedMealConsumption(
  db: SqliteDb,
  actorId: string,
  input: RecordInput
): MealConsumptionRecord {
  if (
    !input ||
    !input.mealId?.trim() ||
    input.mealId.length > 120 ||
    !input.expectedHouseholdId?.trim()
  ) {
    return invalid('mealId u hogar inválido');
  }
  const parsed = householdMealConsumptionSchema.safeParse({
    status: input.status,
    servings: input.servings,
    expectedVersion: input.expectedVersion
  });
  if (!parsed.success) return invalid('Estado de consumo inválido');
  const status = parsed.data.status as ConsumptionStatus;
  const servings = parsed.data.servings;
  const expectedVersion = parsed.data.expectedVersion;

  const transaction = db.transaction((): MealConsumptionRecord => {
    const meal = assertAuthorizedMeal(db, actorId, input.mealId, input.expectedHouseholdId);
    const current = readCurrent(db, input.mealId);
    const currentVersion = current?.version ?? 0;
    if (current?.status === status && current.servings === servings) {
      return {
        mealId: input.mealId,
        status,
        servings,
        version: current.version,
        idempotent: true,
        warnings: readStoredWarnings(current.warnings_json)
      };
    }
    if (expectedVersion !== currentVersion) {
      throw new MealConsumptionError(
        'VERSION_CONFLICT',
        'La confirmación cambió; vuelve a cargarla'
      );
    }
    if (currentVersion >= Number.MAX_SAFE_INTEGER) {
      return invalid('La versión de consumo superó el límite permitido');
    }

    const nextVersion = currentVersion + 1;
    const previousRows = readDeductions(db, input.mealId);
    const snapshot = parseSnapshot(meal.recipe_snapshot);
    const snapshotChanged = Boolean(
      current?.recipe_snapshot_hash && snapshot && current.recipe_snapshot_hash !== snapshot.hash
    );
    if (
      status === 'realized' &&
      ((current?.recipe_snapshot_hash && (!snapshot || snapshotChanged)) ||
        (!snapshot && previousRows.some((row) => row.deducted_quantity > EPSILON)))
    ) {
      throw new MealConsumptionError(
        'RECIPE_SNAPSHOT_UNAVAILABLE',
        'La receta guardada cambió o no está disponible; no se puede corregir el consumo'
      );
    }

    // The deduction rows belong to this current state, so create/update it first inside the same
    // transaction. Any later stock or ledger failure rolls this write back with the rest.
    db.prepare(
      `INSERT INTO meal_consumptions
        (meal_id, household_id, status, servings, version, recorded_by, warnings_json, recipe_snapshot_hash)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?)
       ON CONFLICT(meal_id) DO UPDATE SET
        household_id = excluded.household_id,
        status = excluded.status,
        servings = excluded.servings,
        version = excluded.version,
        recorded_by = excluded.recorded_by,
        warnings_json = '[]',
        recipe_snapshot_hash = COALESCE(meal_consumptions.recipe_snapshot_hash, excluded.recipe_snapshot_hash),
        updated_at = CURRENT_TIMESTAMP`
    ).run(
      input.mealId,
      input.expectedHouseholdId,
      status,
      servings,
      nextVersion,
      actorId,
      snapshot?.hash ?? null
    );

    let warnings: MealConsumptionWarning[] = [];
    if (status === 'realized' && !snapshot) {
      warnings = [{ code: 'RECIPE_SNAPSHOT_UNAVAILABLE' }];
      // Preserve any prior ledger if there are no deductions; an invalid snapshot must not invent
      // ingredient quantities. For a no-stock prior record, keep the record correctable.
      db.prepare('DELETE FROM meal_consumption_deductions WHERE meal_id = ?').run(input.mealId);
    } else {
      warnings = reconcileDeductions(
        db,
        meal,
        input.mealId,
        nextVersion,
        status,
        servings,
        snapshotChanged || !snapshot ? null : snapshot.ingredients,
        previousRows
      ).warnings;
    }

    db.prepare(
      `UPDATE meal_consumptions SET warnings_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE meal_id = ?`
    ).run(JSON.stringify(warnings), input.mealId);
    return {
      mealId: input.mealId,
      status,
      servings,
      version: nextVersion,
      idempotent: false,
      warnings
    };
  });
  return transaction.immediate();
}
