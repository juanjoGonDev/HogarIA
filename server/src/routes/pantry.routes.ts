import { Hono } from 'hono';
import {
  CATALOGO_DE_VIDA,
  buildShelfPrompt,
  caducidadesDe,
  shelfAnswerSchema
} from '../utils/caducidades.js';
import { AiCallError, callAI, extractJsonObject } from '../utils/ai-client.js';
import { EXPIRY_ESTIMATE_RESPONSE_FORMAT } from '../schemas/ai-generated-output.schema.js';
import {
  bulkProductIdsSchema,
  catalogAddSchema,
  catalogFilterSchema,
  createPantryCategorySchema,
  createProductSchema,
  pantryCategoryFilterSchema,
  productFilterSchema,
  updatePantryCategorySchema,
  updateProductSchema
} from '../schemas/pantry.schema.js';
import {
  PROTECTED_PANTRY_KEY,
  DEFAULT_PANTRY_CATEGORIES,
  PantryCategoryProtectedError,
  createCategory,
  deleteImpact,
  ensureDefaultCategories,
  findCategoryById,
  findCategoryByKey,
  listCategories,
  pantryCategoryKey,
  updateCategory,
  clavesDeSubarbol
} from '../utils/pantry-categories.js';
import {
  CATALOGO_CATEGORIAS,
  buscarProductos,
  conteoPorHoja,
  productoPorId
} from '../utils/supermarket-catalog.js';
import { productKeyOf } from '../utils/product-key.js';
import { nanoid } from 'nanoid';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  ASSISTANT_HOUSEHOLD_HEADER,
  ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED,
  assistantHouseholdContextMiddleware,
  currentAssistantHouseholdSnapshot
} from '../utils/ai-assistant-household-context.js';
import {
  ASSISTANT_ACTION_ID_HEADER,
  withAssistantActionIdempotency
} from '../utils/assistant-action-idempotency.js';
import {
  assistantPantryIngredientIdentitiesMatch,
  assistantPantryIngredientScope,
  comparablePantryIngredientName,
  comparablePantryIngredientUpdatedAt,
  readAssistantVisiblePantryIngredientIdentities
} from '../utils/assistant-pantry-ingredient-scope.js';
import { activeHouseholdId } from '../utils/household-context.js';
import { queueProductImageSearch } from '../utils/product-image-search.js';
import {
  createIngredientSchema,
  updateIngredientSchema,
  ingredientFilterSchema,
  createUtensilSchema,
  updateUtensilSchema,
  utensilFilterSchema
} from '../schemas/pantry.schema.js';
import { assistantUpdateIngredientSchema } from '../schemas/ai-assistant-pantry-update.schema.js';
import type { AppEnv } from '../types/hono-env.js';

const pantryRoutes = new Hono<AppEnv>();

function enqueueIngredientPhoto(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  ingredientId: string,
  householdId?: string | null
): void {
  try {
    if (householdId === undefined) queueProductImageSearch(db, userId, ingredientId);
    else queueProductImageSearch(db, userId, ingredientId, { householdId });
  } catch {
    // La búsqueda es auxiliar: un proveedor sin capacidad no revierte el alta de inventario.
  }
}

// Apply auth middleware to all routes
pantryRoutes.use('*', authMiddleware);
pantryRoutes.use('*', assistantHouseholdContextMiddleware());

/**
 * Returns the user's household context:
 *   { householdId, scope: 'user_id = ?' | '(user_id = ? OR household_id = ?)', params }
 * If shared_pantry = 1, items belonging to the household are visible to all members.
 */
function getUserScope(userId: string, householdSnapshot?: string | null) {
  const db = getDatabase();
  const householdId =
    householdSnapshot === undefined ? activeHouseholdId(db, userId) : householdSnapshot;
  const household = householdId
    ? (db.prepare('SELECT shared_pantry FROM households WHERE id = ?').get(householdId) as
        { shared_pantry: number } | undefined)
    : undefined;

  if (householdId && household?.shared_pantry) {
    return {
      householdId,
      userClause: '(household_id = ? OR (household_id IS NULL AND user_id = ?))',
      userParams: [householdId, userId],
      memberClause: '(household_id = ? OR (household_id IS NULL AND user_id = ?))',
      memberParams: [householdId, userId]
    };
  }
  if (householdId) {
    return {
      householdId,
      userClause: '((household_id = ? AND user_id = ?) OR (household_id IS NULL AND user_id = ?))',
      userParams: [householdId, userId, userId],
      memberClause:
        '((household_id = ? AND user_id = ?) OR (household_id IS NULL AND user_id = ?))',
      memberParams: [householdId, userId, userId]
    };
  }
  return {
    householdId: null,
    userClause: '(household_id IS NULL AND user_id = ?)',
    userParams: [userId],
    memberClause: '(household_id IS NULL AND user_id = ?)',
    memberParams: [userId]
  };
}

// ═══════════════════════════════════════════════════════════════════
// Ingredients
// ═══════════════════════════════════════════════════════════════════

// GET /api/pantry/ingredients
pantryRoutes.get('/ingredients', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query();
  const filter = ingredientFilterSchema.parse(query);

  const db = getDatabase();
  const scope = getUserScope(userId);
  const conditions: string[] = [scope.userClause];
  const params: any[] = [...scope.userParams];

  if (filter.search) {
    conditions.push('name LIKE ?');
    params.push(`%${filter.search}%`);
  }

  if (filter.category) {
    // Desde la ## 12aa el filtro es por SUBARBOL: pinchar el padre `alimentos` (o cualquier padre que la casa
    // se fabrique) muestra lo que cuelga debajo, no solo lo que tiene el padre puesto en la fila. Un boton de
    // filtro que pinta cero filas es el boton roto de la ronda 28 repetido del lado de los datos.
    const claves = clavesDeSubarbol(db, scopeDePantry(userId), filter.category);
    conditions.push(`category IN (${claves.map(() => '?').join(', ')})`);
    params.push(...claves);
  }

  if (filter.location) {
    conditions.push('location = ?');
    params.push(filter.location);
  }

  if (filter.expiringSoon) {
    // Se compara DE DIA, no de instante. `expiration_date` guarda un dia suelto
    // («2026-12-31»), y en la comparacion lexicografica ese dia es MENOR que
    // «2026-12-31 10:50:08» que devuelve `datetime('now')`: lo que caduca hoy contaba como
    // caducado desde la primera hora de la manana. Con `date()` las dos cosas se dicen en el
    // mismo idioma. El reloj es el del server (UTC) a proposito: no hay zona configurada, y
    // lo que se ve en la pantalla lo decide el dia local del dispositivo.
    conditions.push("expiration_date IS NOT NULL AND date(expiration_date) >= date('now')");
    conditions.push(
      "expiration_date IS NOT NULL AND date(expiration_date) <= date('now', '+3 days')"
    );
  }

  if (filter.expired) {
    conditions.push("expiration_date IS NOT NULL AND date(expiration_date) < date('now')");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (filter.page - 1) * filter.pageSize;

  // Get total count
  const countResult = db
    .prepare(`SELECT COUNT(*) as total FROM ingredients ${whereClause}`)
    .get(...params) as any;

  // Get paginated results
  const ingredients = db
    .prepare(
      `SELECT * FROM ingredients ${whereClause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...params, filter.pageSize, offset);

  return c.json({
    success: true,
    data: {
      ingredients,
      total: countResult.total,
      page: filter.page,
      pageSize: filter.pageSize,
      totalPages: Math.ceil(countResult.total / filter.pageSize)
    }
  });
});

// GET /api/pantry/ingredients/stats
pantryRoutes.get('/ingredients/stats', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const scope = getUserScope(userId);

  // Quantity > 0 = "in pantry"; qty 0 entries are just common suggestions
  const inPantryClause = `(${scope.userClause}) AND quantity > 0`;
  const inPantryParams = [...scope.userParams];

  // Get total items (only items actually in pantry)
  const totalResult = db
    .prepare(`SELECT COUNT(*) as total FROM ingredients WHERE ${inPantryClause}`)
    .get(...inPantryParams) as any;

  // Get expiring soon (next 3 days)
  const expiringSoonResult = db
    .prepare(
      `
    SELECT COUNT(*) as total FROM ingredients
    WHERE ${inPantryClause}
    AND expiration_date IS NOT NULL
    AND date(expiration_date) >= date('now')
    AND date(expiration_date) <= date('now', '+3 days')
  `
    )
    .get(...inPantryParams) as any;

  // Get expired
  const expiredResult = db
    .prepare(
      `
    SELECT COUNT(*) as total FROM ingredients
    WHERE ${inPantryClause}
    AND expiration_date IS NOT NULL
    AND date(expiration_date) < date('now')
  `
    )
    .get(...inPantryParams) as any;

  // Get by category
  const byCategory = db
    .prepare(
      `
    SELECT category, COUNT(*) as count
    FROM ingredients
    WHERE ${inPantryClause}
    GROUP BY category
  `
    )
    .all(...inPantryParams);

  // Get by location
  const byLocation = db
    .prepare(
      `
    SELECT location, COUNT(*) as count
    FROM ingredients
    WHERE ${inPantryClause}
    GROUP BY location
  `
    )
    .all(...inPantryParams);

  return c.json({
    success: true,
    data: {
      total: totalResult.total,
      expiringSoon: expiringSoonResult.total,
      expired: expiredResult.total,
      byCategory: Object.fromEntries(byCategory.map((r: any) => [r.category, r.count])),
      byLocation: Object.fromEntries(byLocation.map((r: any) => [r.location, r.count]))
    }
  });
});

// GET /api/pantry/ingredients/:id
pantryRoutes.get('/ingredients/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = getDatabase();
  const scope = getUserScope(userId);
  const ownerClause = 'user_id = ? AND (household_id = ? OR household_id IS NULL)';
  const ownerParams = [userId, scope.householdId];

  const ingredient = db
    .prepare(`SELECT * FROM ingredients WHERE id = ? AND ${ownerClause}`)
    .get(id, ...ownerParams);

  if (!ingredient) {
    return c.json(
      {
        success: false,
        message: 'Ingredient not found'
      },
      404
    );
  }

  return c.json({
    success: true,
    data: ingredient
  });
});

// POST /api/pantry/ingredients
pantryRoutes.post('/ingredients', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = createIngredientSchema.parse(body);

  const db = getDatabase();
  const assistantSnapshot = currentAssistantHouseholdSnapshot(c);
  if (!assistantSnapshot.valid) {
    return c.json({ success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED }, 409);
  }
  const scope = getUserScope(userId, assistantSnapshot.householdId);
  const categoriaMala = comprobarCategoria(
    c,
    db,
    scopeDePantry(userId, assistantSnapshot.householdId),
    input.category
  );
  if (categoriaMala) return categoriaMala;

  const result = withAssistantActionIdempotency(
    db,
    userId,
    c.req.header(ASSISTANT_ACTION_ID_HEADER),
    { operation: 'pantry.add_ingredient', householdId: scope.householdId, input },
    () => {
      if (!currentAssistantHouseholdSnapshot(c).valid) {
        return {
          body: { success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED },
          status: 409,
          record: false
        };
      }
      if (c.req.header(ASSISTANT_ACTION_ID_HEADER) !== undefined) {
        const visibleIngredients = readAssistantVisiblePantryIngredientIdentities(
          db,
          userId,
          scope.householdId
        );
        if (
          visibleIngredients.some((ingredient) =>
            assistantPantryIngredientIdentitiesMatch(ingredient, input)
          )
        ) {
          return {
            body: { success: false, code: 'ASSISTANT_INGREDIENT_NAME_CONFLICT' },
            status: 409,
            record: false
          };
        }
      }
      const id = nanoid();
      db.prepare(
        `
    INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, expiration_date, location, image, barcode, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
      ).run(
        id,
        userId,
        scope.householdId,
        input.name,
        input.category,
        input.quantity,
        input.unit,
        input.expirationDate,
        input.location,
        input.image,
        input.barcode,
        input.notes
      );

      const ingredient = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
      enqueueIngredientPhoto(db, userId, id, scope.householdId);
      return { body: { success: true, data: ingredient }, status: 201 };
    }
  );

  if ('error' in result) {
    return result.error === 'invalid_action_id'
      ? c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400)
      : c.json({ success: false, code: 'ASSISTANT_ACTION_ID_CONFLICT' }, 409);
  }
  return c.json(result.body, result.status);
});

// PATCH /api/pantry/ingredients/:id
pantryRoutes.patch('/ingredients/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = updateIngredientSchema.parse(body);

  const db = getDatabase();
  const scope = getUserScope(userId);
  const ownerClause = 'user_id = ? AND (household_id = ? OR household_id IS NULL)';
  const ownerParams = [userId, scope.householdId];

  // Check if ingredient exists and belongs to user
  const existing = db
    .prepare(`SELECT id FROM ingredients WHERE id = ? AND ${ownerClause}`)
    .get(id, ...ownerParams);

  if (!existing) {
    return c.json(
      {
        success: false,
        message: 'Ingredient not found'
      },
      404
    );
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.category !== undefined) {
    // Null = «sin categoria», y sin categoria es la reserva: nunca un valor suelto en la columna, porque
    // entonces el agrupado de la pantalla tendria un grupo sin nombre. Y el valor tiene que estar en el
    // catalogo de la casa (## 12x): una clave inventada agrupa como si fuera una categoria mas.
    const categoria =
      input.category === null || String(input.category).trim() === ''
        ? 'other'
        : String(input.category).trim();
    const scopeDeCasa = getUserScope(userId);
    const mala = comprobarCategoria(
      c,
      db,
      { userId, householdId: scopeDeCasa.householdId ?? null },
      categoria
    );
    if (mala) return mala;
    updates.push('category = ?');
    values.push(categoria);
  }

  if (input.quantity !== undefined) {
    updates.push('quantity = ?');
    // El hueco elegido es 0, no `null`: «sin existencias» y 0 son la misma cosa en la despensa, y la
    // columna es NOT NULL —empujar el `null` del PATCH vaciado era un 500 con muy mala educacion—.
    values.push(input.quantity ?? 0);
  }

  if (input.unit !== undefined) {
    updates.push('unit = ?');
    values.push(input.unit);
  }

  if (input.expirationDate !== undefined) {
    updates.push('expiration_date = ?');
    values.push(input.expirationDate);
  }

  if (input.location !== undefined) {
    updates.push('location = ?');
    values.push(input.location);
  }

  if (input.notes !== undefined) {
    updates.push('notes = ?');
    values.push(input.notes);
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, ...ownerParams);

    db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ? AND ${ownerClause}`).run(
      ...values
    );
  }

  const ingredient = db
    .prepare(`SELECT * FROM ingredients WHERE id = ? AND ${ownerClause}`)
    .get(id, ...ownerParams);

  return c.json({
    success: true,
    data: ingredient
  });
});

pantryRoutes.patch('/ingredients/:id/assistant-update', async (c) => {
  const actionId = c.req.header(ASSISTANT_ACTION_ID_HEADER);
  if (!actionId) return c.json({ success: false, code: 'ASSISTANT_ACTION_ID_REQUIRED' }, 400);
  if (c.req.header(ASSISTANT_HOUSEHOLD_HEADER) === undefined) {
    return c.json({ success: false, code: 'ASSISTANT_HOUSEHOLD_CONTEXT_REQUIRED' }, 400);
  }

  const body = assistantUpdateIngredientSchema.parse(await c.req.json());
  const targetId = c.req.param('id');
  if (body.assistantAction.targetId !== targetId) {
    return c.json({ success: false, code: 'ASSISTANT_ACTION_TARGET_MISMATCH' }, 400);
  }

  const db = getDatabase();
  const userId = c.get('userId');
  const assistantSnapshot = currentAssistantHouseholdSnapshot(c);
  if (!assistantSnapshot.valid) {
    return c.json({ success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED }, 409);
  }
  const scope = assistantPantryIngredientScope(userId, assistantSnapshot.householdId ?? null);
  const before = body.assistantAction.before;
  const result = withAssistantActionIdempotency(
    db,
    userId,
    actionId,
    {
      operation: 'pantry.update_ingredient',
      householdId: scope.householdId,
      ingredientId: targetId,
      before,
      changes: body.changes
    },
    () => {
      if (!currentAssistantHouseholdSnapshot(c).valid) {
        return {
          body: { success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED },
          status: 409,
          record: false
        };
      }

      const ingredient = db
        .prepare(
          `SELECT id, name, category, quantity, unit, expiration_date, location, notes, updated_at
             FROM ingredients WHERE id = ? AND ${scope.clause}`
        )
        .get(targetId, ...scope.params) as
        | {
            id: string;
            name: string;
            category: string;
            quantity: number;
            unit: string;
            expiration_date: string | null;
            location: string | null;
            notes: string | null;
            updated_at: string | null;
          }
        | undefined;
      if (!ingredient) {
        return {
          body: { success: false, message: 'Ingredient not found' },
          status: 404,
          record: false
        };
      }

      const current = {
        name: ingredient.name,
        category: ingredient.category,
        quantity: Number(ingredient.quantity),
        unit: ingredient.unit,
        expirationDate: ingredient.expiration_date,
        location: ingredient.location,
        notes: ingredient.notes,
        updatedAt: ingredient.updated_at
      };
      if (
        current.name !== before.name ||
        current.category !== before.category ||
        current.quantity !== before.quantity ||
        current.unit !== before.unit ||
        current.expirationDate !== before.expirationDate ||
        current.location !== before.location ||
        current.notes !== before.notes ||
        comparablePantryIngredientUpdatedAt(current.updatedAt) !==
          comparablePantryIngredientUpdatedAt(before.updatedAt)
      ) {
        return {
          body: { success: false, code: 'ASSISTANT_INGREDIENT_STALE' },
          status: 409,
          record: false
        };
      }

      const updates = Object.entries(body.changes).filter(
        ([field, value]) => value !== current[field as keyof typeof current]
      );
      if (updates.length === 0) {
        return {
          body: { success: false, code: 'ASSISTANT_ACTION_NO_CHANGE' },
          status: 400,
          record: false
        };
      }

      if (body.changes.name !== undefined && body.changes.name !== current.name) {
        const otherNames = db
          .prepare(`SELECT id, name FROM ingredients WHERE ${scope.clause} AND id != ?`)
          .all(...scope.params, targetId) as Array<{ id: string; name: string }>;
        if (
          otherNames.some(
            (row) =>
              comparablePantryIngredientName(row.name) ===
              comparablePantryIngredientName(body.changes.name!)
          )
        ) {
          return {
            body: { success: false, code: 'ASSISTANT_INGREDIENT_NAME_CONFLICT' },
            status: 409,
            record: false
          };
        }
      }

      if (body.changes.category !== undefined) {
        const pantryScope = scopeDePantry(userId, scope.householdId);
        if (!findCategoryByKey(db, pantryScope, body.changes.category)) {
          if (
            DEFAULT_PANTRY_CATEGORIES.some((category) => category.key === body.changes.category)
          ) {
            ensureDefaultCategories(db, pantryScope.userId, pantryScope.householdId);
          }
          if (!findCategoryByKey(db, pantryScope, body.changes.category)) {
            return {
              body: { success: false, code: 'PANTRY_CATEGORY_UNKNOWN' },
              status: 400,
              record: false
            };
          }
        }
      }

      const columnByField = {
        name: 'name',
        category: 'category',
        quantity: 'quantity',
        unit: 'unit',
        expirationDate: 'expiration_date',
        location: 'location',
        notes: 'notes'
      } as const;
      const assignments = updates.map(
        ([field]) => `${columnByField[field as keyof typeof columnByField]} = ?`
      );
      assignments.push('updated_at = CURRENT_TIMESTAMP');
      const write = db
        .prepare(
          `UPDATE ingredients SET ${assignments.join(', ')}
             WHERE id = ? AND ${scope.clause}
               AND name IS ? AND category IS ? AND quantity IS ? AND unit IS ?
               AND expiration_date IS ? AND location IS ? AND notes IS ? AND updated_at IS ?`
        )
        .run(
          ...updates.map(([, value]) => value),
          targetId,
          ...scope.params,
          current.name,
          current.category,
          current.quantity,
          current.unit,
          current.expirationDate,
          current.location,
          current.notes,
          current.updatedAt
        );
      if (write.changes !== 1) {
        return {
          body: { success: false, code: 'ASSISTANT_INGREDIENT_STALE' },
          status: 409,
          record: false
        };
      }

      const updatedIngredient = db
        .prepare(`SELECT * FROM ingredients WHERE id = ? AND ${scope.clause}`)
        .get(targetId, ...scope.params);
      return { body: { success: true, data: updatedIngredient }, status: 200 };
    }
  );

  if ('error' in result) {
    return result.error === 'invalid_action_id'
      ? c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400)
      : c.json({ success: false, code: 'ASSISTANT_ACTION_ID_CONFLICT' }, 409);
  }
  return c.json(result.body, result.status);
});

// DELETE /api/pantry/ingredients/:id
pantryRoutes.delete('/ingredients/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = getDatabase();
  const scope = getUserScope(userId);

  const result = db
    .prepare(
      `DELETE FROM ingredients WHERE id = ? AND user_id = ?
       AND (household_id = ? OR household_id IS NULL)`
    )
    .run(id, userId, scope.householdId);

  if (result.changes === 0) {
    return c.json(
      {
        success: false,
        message: 'Ingredient not found'
      },
      404
    );
  }

  return c.json({
    success: true,
    message: 'Ingredient deleted'
  });
});

// ═══════════════════════════════════════════════════════════════════
// Utensils
// ═══════════════════════════════════════════════════════════════════

// GET /api/pantry/utensils
pantryRoutes.get('/utensils', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query();
  const filter = utensilFilterSchema.parse(query);

  const db = getDatabase();
  const scope = getUserScope(userId);
  const conditions: string[] = [scope.userClause];
  const params: any[] = [...scope.userParams];

  if (filter.search) {
    conditions.push('name LIKE ?');
    params.push(`%${filter.search}%`);
  }

  if (filter.category) {
    conditions.push('category = ?');
    params.push(filter.category);
  }

  if (filter.available !== undefined) {
    conditions.push('available = ?');
    params.push(filter.available ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const utensils = db
    .prepare(`SELECT * FROM utensils ${whereClause} ORDER BY name ASC`)
    .all(...params);

  return c.json({
    success: true,
    data: utensils
  });
});

// POST /api/pantry/utensils
pantryRoutes.post('/utensils', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = createUtensilSchema.parse(body);

  const db = getDatabase();
  const id = nanoid();

  const scope = getUserScope(userId);

  db.prepare(
    `
    INSERT INTO utensils (id, user_id, household_id, name, category, available, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    userId,
    scope.householdId,
    input.name,
    input.category,
    input.available ? 1 : 0,
    input.notes
  );

  const utensil = db.prepare('SELECT * FROM utensils WHERE id = ?').get(id);

  return c.json(
    {
      success: true,
      data: utensil
    },
    201
  );
});

// PATCH /api/pantry/utensils/:id
// Household-shared utensils (have household_id) can be toggled by any member
// of the household, since marking what's available is a household-wide setting.
pantryRoutes.patch('/utensils/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = updateUtensilSchema.parse(body);

  const db = getDatabase();
  const scope = getUserScope(userId);

  const existing = db
    .prepare(`SELECT id FROM utensils WHERE id = ? AND ${scope.memberClause}`)
    .get(id, ...scope.memberParams);

  if (!existing) {
    return c.json(
      {
        success: false,
        message: 'Utensil not found'
      },
      404
    );
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.category !== undefined) {
    updates.push('category = ?');
    values.push(input.category);
  }

  if (input.available !== undefined) {
    updates.push('available = ?');
    values.push(input.available ? 1 : 0);
  }

  if (input.notes !== undefined) {
    updates.push('notes = ?');
    values.push(input.notes);
  }

  if (updates.length > 0) {
    values.push(id);
    values.push(...scope.memberParams);
    db.prepare(
      `UPDATE utensils SET ${updates.join(', ')} WHERE id = ? AND ${scope.memberClause}`
    ).run(...values);
  }

  const utensil = db.prepare('SELECT * FROM utensils WHERE id = ?').get(id);

  return c.json({
    success: true,
    data: utensil
  });
});

// DELETE /api/pantry/utensils/:id
pantryRoutes.delete('/utensils/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = getDatabase();
  const scope = getUserScope(userId);

  const result = db
    .prepare(
      'DELETE FROM utensils WHERE id = ? AND user_id = ? AND (household_id = ? OR household_id IS NULL)'
    )
    .run(id, userId, scope.householdId);

  if (result.changes === 0) {
    return c.json(
      {
        success: false,
        message: 'Utensil not found'
      },
      404
    );
  }

  return c.json({
    success: true,
    message: 'Utensil deleted'
  });
});

// ── Las caducidades de la casa (HOGARIA-SPEC ## 12ak) ──

/**
 * La lista para la pantalla de caducidades: cada producto con stock, su fecha (registrada o
 * estimada), los dias que le quedan y su ritmo de compra. Sin query params a proposito: el
 * orden lo decide el servidor (urgencia) y la pantalla reordena en memoria —una lista de
 * despensa no da para paginar—.
 */
pantryRoutes.get('/expiry', (c) => {
  const filas = caducidadesDe(getDatabase(), c.get('userId'));
  return c.json({ success: true, data: filas });
});

/**
 * Estimar la vida util de lo que no tiene ni fecha ni estimacion: primero el catalogo de
 * bolsillo (que no gasta IA y cubre el pan y la leche de toda la vida) y el RESTO por la IA
 * local, que escribe su dias en `estimated_shelf_days`. Sin configuracion de IA no es un
 * error del servidor: 409 con NO_CONFIG, como la foto de la cesta.
 */
pantryRoutes.post('/expiry/estimate', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getUserScope(userId);
  const candidatos = db
    .prepare(
      `SELECT id, name, unit, category FROM ingredients
       WHERE ${scope.userClause} AND quantity > 0
         AND expiration_date IS NULL AND estimated_shelf_days IS NULL
       ORDER BY name ASC LIMIT 60`
    )
    .all(...scope.userParams) as {
    id: string;
    name: string;
    unit: string | null;
    category: string;
  }[];
  if (candidatos.length === 0) {
    return c.json({ success: true, data: { catalogo: 0, ia: 0, sinEstimar: 0, sinFecha: 0 } });
  }

  const delCatalogo = candidatos.filter((fila) => CATALOGO_DE_VIDA[productKeyOf(fila.name)]);
  const paraLaIa = candidatos.filter((fila) => !CATALOGO_DE_VIDA[productKeyOf(fila.name)]);

  let estimadosPorIa = 0;
  if (paraLaIa.length > 0) {
    const { system, user } = buildShelfPrompt(paraLaIa);
    let respuesta: unknown;
    try {
      respuesta = extractJsonObject(
        await callAI(
          userId,
          [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          db,
          EXPIRY_ESTIMATE_RESPONSE_FORMAT,
          'expiry_estimate'
        )
      );
    } catch (error) {
      if (error instanceof AiCallError) {
        const estado = error.code === 'NO_CONFIG' ? 409 : error.code === 'BAD_JSON' ? 422 : 502;
        return falla(c, estado, error.message, error.code);
      }
      throw error;
    }
    const contestacion = shelfAnswerSchema.parse(respuesta);
    const porClave = new Map(paraLaIa.map((fila) => [productKeyOf(fila.name), fila.id]));
    for (const producto of contestacion.products) {
      const id = porClave.get(productKeyOf(producto.name));
      if (!id) continue;
      db.prepare(
        'UPDATE ingredients SET estimated_shelf_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(producto.days, id);
      estimadosPorIa += 1;
    }
  }

  return c.json({
    success: true,
    data: {
      catalogo: delCatalogo.length,
      ia: estimadosPorIa,
      sinEstimar: paraLaIa.length - estimadosPorIa,
      sinFecha: candidatos.length
    }
  });
});

export { pantryRoutes };

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * EL GESTOR DEL INVENTARIO — categorias de la casa y productos principales (HOGARIA-SPEC ## 12x)
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Todo lo que decide *si se puede* vive en `utils/pantry-categories.ts`; aqui solo lo que le toca a una
 * ruta: el ambito de la casa, la forma del envelope y los codigos de error con su impacto dentro. Dos
 * cosas de estas respuestas no son negociables y por eso estan escritas:
 *
 *   - `meta.total` es el total **filtrado**, no lo que cabria en la pagina. Es la diferencia entre «3 de
 *     42» y «3 de 10», y la segunda no se puede paginar ni entender.
 *   - Un 409 lleva el recuento en `details`. «No se puede borrar» sin numeros obliga a ir probando
 *     articulo por articulo; «42 articulos y 3 subcategorias» dice donde hay que mirar.
 *
 * El paginador del gestor es `limit`/`offset` (diez por defecto) y no `page`/`pageSize` como el del listado
 * de la despensa: son dos clientes distintos, y el gestor es el que imita a la cesta, que es donde la casa
 * ya sabe lo que significa «pagina 2».
 */

type Casa = { userId: string; householdId: string | null };

function scopeDePantry(userId: string, householdSnapshot?: string | null): Casa {
  const scope = getUserScope(userId, householdSnapshot);
  // `householdId` solo viene puesto cuando la casa comparte la despensa: el ambito del catalogo es, a
  // proposito, el mismo ambito de las filas. Categorias que no se ven con los articulos que agrupan son la
  // mitad del bug que hacia que «Otros» se llenara solo.
  return { userId, householdId: scope.householdId ?? null };
}

/**
 * El envelope de error del proyecto, en una linea y con su status: `{success:false, error, message, details?}`.
 * Existe porque sin ella cada ruta escribia el objeto a mano y alguna se dejaba `details` fuera —que es justo
 * el campo que permite al dialogo decir «42 articulos» en vez de «no se puede»—. `c` entra como `any` a
 * proposito: es el contexto de Hono, y arrastrar el tipo generico para un helper de este fichero es ruido.
 */
function falla(
  c: any,
  status: number,
  message: string,
  error: string,
  details?: unknown
): Response {
  return c.json(
    { success: false, error, message, ...(details === undefined ? {} : { details }) },
    status
  );
}

/**
 * La clave tiene que existir en el catalogo de la casa. Se siembra antes de comprobar, para que una casa
 * antigua no reciba un 400 por una categoria que existio siempre: si no hay filas, las doce de fabrica son
 * el catalogo, y a partir de ahi ya es cosa suya.
 */
function comprobarCategoria(
  c: any,
  db: ReturnType<typeof getDatabase>,
  casa: Casa,
  category: string
): Response | null {
  ensureDefaultCategories(db, casa.userId, casa.householdId);
  if (findCategoryByKey(db, casa, category)) return null;
  return falla(
    c,
    400,
    `La categoria «${category}» no esta en el catalogo de esta casa`,
    'PANTRY_CATEGORY_UNKNOWN',
    {
      category,
      validKeys: listCategories(db, casa).map((fila) => fila.key)
    }
  );
}

/** Alias: lo que la familia llama al producto. Solo sirven para buscar y para pintar la ficha. */
function normalizarAliases(lista: unknown, nombre: string): string[] {
  if (!Array.isArray(lista)) return [];
  const salida: string[] = [];
  const vistas = new Set<string>();
  for (const entrada of lista) {
    const alias = String(entrada ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!alias) continue;
    const clave = alias.toLowerCase();
    if (clave === nombre.toLowerCase() || vistas.has(clave)) continue; // el nombre no es un alias de si mismo
    vistas.add(clave);
    salida.push(alias);
    if (salida.length >= 20) break;
  }
  return salida;
}

function leerAliases(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map((item) => String(item));
  if (typeof valor !== 'string' || !valor.trim()) return [];
  try {
    const analizado = JSON.parse(valor);
    return Array.isArray(analizado) ? analizado.map((item) => String(item)) : [];
  } catch {
    return []; // una columna con basura no puede reventar una lista: se pinta sin alias y ya
  }
}

// ── Categorias ──

pantryRoutes.get('/categories', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const q = pantryCategoryFilterSchema.parse(c.req.query());
  ensureDefaultCategories(db, casa.userId, casa.householdId);
  const filas = listCategories(db, casa, {
    view: (q.view ?? 'all') as 'all' | 'without-products' | 'with-children',
    q: q.q ?? undefined
  });
  const data = filas.slice(q.offset, q.offset + q.limit);
  return c.json({
    success: true,
    data,
    meta: { total: filas.length, limit: q.limit, offset: q.offset },
    hasMore: q.offset + data.length < filas.length
  });
});

pantryRoutes.post('/categories', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const input = createPantryCategorySchema.parse(await c.req.json());
  ensureDefaultCategories(db, casa.userId, casa.householdId);
  const clave = pantryCategoryKey(input.name);
  if (findCategoryByKey(db, casa, clave)) {
    return falla(
      c,
      409,
      'Ya hay una categoria con ese nombre en esta casa',
      'PANTRY_CATEGORY_EXISTS',
      { key: clave }
    );
  }
  if (input.parentKey && !findCategoryByKey(db, casa, input.parentKey)) {
    return falla(
      c,
      404,
      'La categoria padre no existe en esta casa',
      'PANTRY_CATEGORY_PARENT_NOT_FOUND',
      { parentKey: input.parentKey }
    );
  }
  try {
    const creada = createCategory(db, {
      ...casa,
      name: input.name,
      color: input.color ?? null,
      description: input.description ?? null,
      parentKey: input.parentKey ?? null,
      idFactory: () => `pcat-${nanoid()}`
    });
    return c.json({ success: true, data: creada }, 201);
  } catch (error) {
    if (error instanceof RangeError) return falla(c, 400, error.message, 'PANTRY_CATEGORY_INVALID');
    throw error;
  }
});

pantryRoutes.get('/categories/:id/delete-impact', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  try {
    return c.json({ success: true, data: deleteImpact(db, casa, c.req.param('id')) });
  } catch (error) {
    if (error instanceof RangeError) {
      return falla(c, 404, 'La categoria no existe en esta casa', 'PANTRY_CATEGORY_NOT_FOUND');
    }
    throw error;
  }
});

pantryRoutes.patch('/categories/:id', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const id = c.req.param('id');
  const input = updatePantryCategorySchema.parse(await c.req.json());
  ensureDefaultCategories(db, casa.userId, casa.householdId);
  const actual = findCategoryById(db, casa, id);
  if (!actual)
    return falla(c, 404, 'La categoria no existe en esta casa', 'PANTRY_CATEGORY_NOT_FOUND');
  // Renombrar y mover son las dos cosas que rompen la reserva; pintar y anotar no. Se comprueba aqui, en la
  // forma cruda del PATCH, porque `parentKey: null` (subir de nivel) es un cambio de estructura que llega
  // como `null` y un `if (input.parentKey !== undefined)` de andar por casa lo contaria como «no tocar».
  const tocaEstructura = Boolean(input.name) || 'parentKey' in input;
  if (actual.key === PROTECTED_PANTRY_KEY && tocaEstructura) {
    return falla(
      c,
      409,
      'La categoria de reserva se puede pintar y anotar, pero no renombrar ni mover: ahi cae todo lo que no encaja',
      'PANTRY_CATEGORY_PROTECTED',
      { key: PROTECTED_PANTRY_KEY }
    );
  }
  if (input.name) {
    const claveNueva = pantryCategoryKey(String(input.name));
    if (claveNueva !== actual.key && findCategoryByKey(db, casa, claveNueva)) {
      return falla(
        c,
        409,
        'Ya hay una categoria con ese nombre en esta casa',
        'PANTRY_CATEGORY_EXISTS',
        { key: claveNueva }
      );
    }
  }
  if (input.parentKey && !findCategoryByKey(db, casa, String(input.parentKey))) {
    return falla(
      c,
      404,
      'La categoria padre no existe en esta casa',
      'PANTRY_CATEGORY_PARENT_NOT_FOUND',
      { parentKey: input.parentKey }
    );
  }
  try {
    const fila = updateCategory(db, {
      ...casa,
      id,
      patch: {
        ...(input.name === undefined || input.name === null ? {} : { name: String(input.name) }),
        ...(input.color === undefined
          ? {}
          : { color: input.color == null ? null : String(input.color) }),
        ...(input.description === undefined
          ? {}
          : { description: input.description == null ? null : String(input.description) }),
        ...('parentKey' in input
          ? { parentKey: input.parentKey == null ? null : String(input.parentKey) }
          : {})
      }
    });
    return c.json({ success: true, data: fila });
  } catch (error) {
    if (error instanceof PantryCategoryProtectedError) {
      return falla(c, 409, error.message, 'PANTRY_CATEGORY_PROTECTED', {
        key: PROTECTED_PANTRY_KEY
      });
    }
    if (error instanceof RangeError) return falla(c, 400, error.message, 'PANTRY_CATEGORY_INVALID');
    throw error;
  }
});

pantryRoutes.delete('/categories/:id', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const id = c.req.param('id');
  if (!findCategoryById(db, casa, id)) {
    return falla(c, 404, 'La categoria no existe en esta casa', 'PANTRY_CATEGORY_NOT_FOUND');
  }
  const impacto = deleteImpact(db, casa, id);
  if (impacto.protected) {
    return falla(
      c,
      409,
      'La categoria de reserva no se puede borrar',
      'PANTRY_CATEGORY_PROTECTED',
      { key: PROTECTED_PANTRY_KEY }
    );
  }
  if (!impacto.canDelete) {
    return falla(
      c,
      409,
      'La categoria todavia tiene articulos o subcategorias',
      'PANTRY_CATEGORY_IN_USE',
      impacto
    );
  }
  db.prepare('DELETE FROM pantry_categories WHERE id = ?').run(id);
  return c.body(null, 204);
});

// ── Productos principales ──

type FilaIngrediente = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiration_date: string | null;
  location: string | null;
  barcode: string | null;
  notes: string | null;
  image: string | null;
  aliases: string | null;
  created_at: string;
  updated_at: string;
};

function productoDe(fila: FilaIngrediente, nombres: Map<string, string>) {
  return {
    id: fila.id,
    name: fila.name,
    // `category` es la clave cruda —lo que guarda la fila y lo que viaja al prompt—; `categoryName`, la
    // etiqueta del catalogo de esa casa. Si la clave ya no esta (la borro otra persona y el articulo se
    // quedo colgando), se pinta la clave: es feo, y dice la verdad.
    category: fila.category,
    categoryKey: fila.category,
    categoryName: nombres.get(fila.category) ?? fila.category,
    quantity: fila.quantity,
    unit: fila.unit,
    inPantry: fila.quantity > 0,
    expirationDate: fila.expiration_date ? String(fila.expiration_date).slice(0, 10) : null,
    location: fila.location,
    image: fila.image,
    barcode: fila.barcode,
    notes: fila.notes,
    aliases: leerAliases(fila.aliases),
    createdAt: fila.created_at,
    updatedAt: fila.updated_at
  };
}

/** Donde cae un producto: dos criterios de «esto es lo mismo» son dos bugs, asi que manda una sola funcion. */
function buscarPorClave(
  db: ReturnType<typeof getDatabase>,
  casa: Casa,
  nombre: string
): FilaIngrediente | null {
  const scope = getUserScope(casa.userId);
  const candidatos = db
    .prepare(
      `SELECT * FROM ingredients WHERE ${scope.userClause} AND lower(trim(name)) = lower(trim(?))`
    )
    .all(...scope.userParams, nombre) as FilaIngrediente[];
  const clave = productKeyOf(nombre);
  return candidatos.find((fila) => productKeyOf(fila.name) === clave) ?? null;
}

/** Un alias que es el nombre de otro producto crea dos fichas para la misma cosa: se dice, no se calla. */
function buscarAliasEnCasa(
  db: ReturnType<typeof getDatabase>,
  casa: Casa,
  alias: string[],
  nombre: string,
  exceptoId: string | null
) {
  for (const entrada of alias) {
    const encontrada = buscarPorClave(db, casa, entrada);
    if (
      encontrada &&
      encontrada.id !== exceptoId &&
      productKeyOf(encontrada.name) !== productKeyOf(nombre)
    ) {
      return { alias: entrada, productId: encontrada.id, productName: encontrada.name };
    }
  }
  return null;
}

function productoO404(
  db: ReturnType<typeof getDatabase>,
  casa: Casa,
  id: string
): FilaIngrediente | undefined {
  const scope = getUserScope(casa.userId);
  return db
    .prepare(`SELECT * FROM ingredients WHERE id = ? AND ${scope.userClause}`)
    .get(id, ...scope.userParams) as FilaIngrediente | undefined;
}

function scopeParaAlias(scope: ReturnType<typeof getUserScope>, alias: string): string {
  // `alias` solo recibe nombres constantes definidos en estas consultas, nunca entrada del usuario.
  return scope.userClause
    .replace(/\bhousehold_id\b/g, `${alias}.household_id`)
    .replace(/\buser_id\b/g, `${alias}.user_id`);
}

function impactoProducto(
  db: ReturnType<typeof getDatabase>,
  fila: FilaIngrediente,
  userId: string
) {
  const clave = productKeyOf(fila.name);
  const scope = getUserScope(userId);
  const lineas = (
    db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM shopping_list_items sli
           JOIN shopping_lists l ON l.id = sli.list_id
          WHERE sli.product_key = ? AND ${scopeParaAlias(scope, 'l')}`
      )
      .get(clave, ...scope.userParams) as { count: number }
  ).count;
  const precios = (
    db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM price_observations po
          WHERE po.product_key = ? AND ${scopeParaAlias(scope, 'po')}`
      )
      .get(clave, ...scope.userParams) as { count: number }
  ).count;
  return {
    id: fila.id,
    name: fila.name,
    quantity: fila.quantity,
    listLines: lineas,
    priceObservations: precios,
    // Se puede borrar la ficha de algo que no esta en la despensa. Lo que esta dentro se quita de dentro,
    // desde la despensa, con su motivo —no desde un gestor que no ve el estante—.
    canDelete: fila.quantity === 0
  };
}

pantryRoutes.get('/products', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const casa = scopeDePantry(userId);
  const q = productFilterSchema.parse(c.req.query());
  const scope = getUserScope(userId);
  ensureDefaultCategories(db, casa.userId, casa.householdId);
  const nombres = new Map(listCategories(db, casa).map((fila) => [fila.key, fila.name]));

  const conditions: string[] = [scope.userClause];
  const params: unknown[] = [...scope.userParams];
  if (q.q) {
    // Se busca en la nota y en los alias, no solo en el nombre: «el de la plaza, solo los sabados» es
    // exactamente el tipo de cosa que alguien recuerda y no puede teclear de otra manera.
    conditions.push('(name LIKE ? OR notes LIKE ? OR aliases LIKE ? OR barcode LIKE ?)');
    for (let i = 0; i < 4; i++) params.push(`%${q.q}%`);
  }
  if (q.category) {
    // Subarbol igual que en la lista del inventario: el gestor y el visor prometen lo mismo por el mismo
    // precio (ver ## 12aa).
    const claves = clavesDeSubarbol(db, casa, q.category);
    conditions.push(`category IN (${claves.map(() => '?').join(', ')})`);
    params.push(...claves);
  }
  if (q.filter === 'staples') conditions.push('quantity = 0');
  if (q.filter === 'in-pantry') conditions.push('quantity > 0');
  if (q.filter === 'expiring') {
    conditions.push("expiration_date IS NOT NULL AND date(expiration_date) >= date('now')");
    conditions.push(
      "expiration_date IS NOT NULL AND date(expiration_date) <= date('now', '+3 days')"
    );
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM ingredients ${where}`).get(...params) as {
      count: number;
    }
  ).count;
  const orden =
    q.sort === 'recent' ? 'updated_at DESC, name ASC' : 'name COLLATE NOCASE ASC, id ASC';
  const filas = db
    .prepare(`SELECT * FROM ingredients ${where} ORDER BY ${orden} LIMIT ? OFFSET ?`)
    .all(...params, q.limit, q.offset) as FilaIngrediente[];

  // El impacto de cada fila, en dos consultas para la pagina entera: «4 lineas de cesta» es lo que el
  // dialogo de borrado tiene que poder decir antes de que nadie marque nada.
  const claves = [...new Set(filas.map((fila) => productKeyOf(fila.name)))];
  const lineas = new Map<string, number>();
  const precios = new Map<string, number>();
  if (claves.length > 0) {
    const hoyos = claves.map(() => '?').join(', ');
    const lineasPorClave = db
      .prepare(
        `SELECT sli.product_key AS key, COUNT(*) AS count
           FROM shopping_list_items sli
           JOIN shopping_lists l ON l.id = sli.list_id
          WHERE sli.product_key IN (${hoyos}) AND ${scopeParaAlias(scope, 'l')}
          GROUP BY sli.product_key`
      )
      .all(...claves, ...scope.userParams) as { key: string; count: number }[];
    for (const fila of lineasPorClave) lineas.set(fila.key, fila.count);

    const preciosPorClave = db
      .prepare(
        `SELECT po.product_key AS key, COUNT(*) AS count
           FROM price_observations po
          WHERE po.product_key IN (${hoyos}) AND ${scopeParaAlias(scope, 'po')}
          GROUP BY po.product_key`
      )
      .all(...claves, ...scope.userParams) as { key: string; count: number }[];
    for (const fila of preciosPorClave) precios.set(fila.key, fila.count);
  }

  const data = filas.map((fila) => ({
    ...productoDe(fila, nombres),
    impact: {
      listLines: lineas.get(productKeyOf(fila.name)) ?? 0,
      priceObservations: precios.get(productKeyOf(fila.name)) ?? 0
    }
  }));
  return c.json({
    success: true,
    data,
    meta: { total, limit: q.limit, offset: q.offset },
    hasMore: q.offset + data.length < total
  });
});

/**
 * La ficha de UN articulo (## 12ai): la pantalla de detalle del inventario pide el producto con su
 * huella —cuantas lineas de cesta y cuantas observaciones de precio cuelgan de su clave—, no la
 * pagina entera filtrada en el cliente. Mismo alcance que el listado: la casa entera ve la ficha.
 */
pantryRoutes.get('/products/:id', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const fila = productoO404(db, casa, c.req.param('id'));
  if (!fila) return falla(c, 404, 'El producto no existe en esta casa', 'PANTRY_PRODUCT_NOT_FOUND');
  const nombres = new Map(
    listCategories(db, casa).map((categoria) => [categoria.key, categoria.name])
  );
  const impacto = impactoProducto(db, fila, casa.userId);
  return c.json({
    success: true,
    data: {
      ...productoDe(fila, nombres),
      impact: { listLines: impacto.listLines, priceObservations: impacto.priceObservations }
    }
  });
});

pantryRoutes.post('/products', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const casa = scopeDePantry(userId);
  const input = createProductSchema.parse(await c.req.json());
  const mala = comprobarCategoria(c, db, casa, input.category);
  if (mala) return mala;
  const nombres = new Map(listCategories(db, casa).map((fila) => [fila.key, fila.name]));
  const alias = normalizarAliases(input.aliases, input.name);
  const choca = buscarAliasEnCasa(db, casa, alias, input.name, null);
  if (choca) {
    return falla(
      c,
      409,
      `«${choca.alias}» ya es el nombre de otro producto de esta casa: dos fichas para la misma cosa es lo que hay que arreglar aqui, no un aviso`,
      'PANTRY_PRODUCT_ALIAS_CLASH',
      choca
    );
  }

  // Idempotente por clave de producto: registrar dos veces lo mismo no duplica la ficha, y tampoco la
  // renombra —el nombre guardado es el que pinta la pantalla y el que saldra en la cesta.
  const existente = buscarPorClave(db, casa, input.name);
  if (existente)
    return c.json(
      { success: true, data: { ...productoDe(existente, nombres), created: false } },
      200
    );

  const id = nanoid();
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, expiration_date, location, image, barcode, notes, aliases)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    id,
    userId,
    casa.householdId,
    input.name.trim(),
    input.category,
    input.quantity ?? 0,
    input.unit ?? 'unit',
    input.expirationDate ?? null,
    input.location ?? 'pantry',
    input.barcode?.trim() || null,
    input.notes ?? null,
    JSON.stringify(alias)
  );
  const fila = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as FilaIngrediente;
  enqueueIngredientPhoto(db, userId, id);
  return c.json({ success: true, data: { ...productoDe(fila, nombres), created: true } }, 201);
});

pantryRoutes.patch('/products/:id', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const casa = scopeDePantry(userId);
  const id = c.req.param('id');
  const input = updateProductSchema.parse(await c.req.json());
  const existente = productoO404(db, casa, id);
  if (!existente)
    return falla(c, 404, 'El producto no existe en esta casa', 'PANTRY_PRODUCT_NOT_FOUND');

  const updates: string[] = [];
  const values: unknown[] = [];
  if (input.category !== undefined) {
    const categoria =
      input.category === null || String(input.category).trim() === ''
        ? 'other'
        : String(input.category).trim();
    const mala = comprobarCategoria(c, db, casa, categoria);
    if (mala) return mala;
    updates.push('category = ?');
    values.push(categoria);
  }
  if (input.name) {
    updates.push('name = ?');
    values.push(String(input.name).trim());
  }
  if (input.unit) {
    updates.push('unit = ?');
    values.push(input.unit);
  }
  // `notes: null` y `aliases: null` significan «quitar», no «dejar como estaba» —es la diferencia que
  // `formPartial` existe para poder expresar, y en la ficha del producto se nota: la nota se borra.
  if (input.notes !== undefined) {
    updates.push('notes = ?');
    values.push(input.notes ?? null);
  }
  if (input.aliases !== undefined) {
    const nombreFinal = input.name ? String(input.name).trim() : existente.name;
    const alias = input.aliases === null ? [] : normalizarAliases(input.aliases, nombreFinal);
    const choca = buscarAliasEnCasa(db, casa, alias, nombreFinal, existente.id);
    if (choca)
      return falla(
        c,
        409,
        `«${choca.alias}» ya es el nombre de otro producto de esta casa`,
        'PANTRY_PRODUCT_ALIAS_CLASH',
        choca
      );
    updates.push('aliases = ?');
    values.push(JSON.stringify(alias));
  }
  if (input.expirationDate !== undefined) {
    updates.push('expiration_date = ?');
    values.push(input.expirationDate ?? null);
  }
  // Ubicacion y codigo de barras (## 12ai): la ficha del articulo los edita aqui. La ubicacion no
  // tiene «ninguna» —null vuelve a la de siempre, la despensa— y el codigo si se quita con null.
  if (input.location !== undefined) {
    updates.push('location = ?');
    values.push(input.location ?? 'pantry');
  }
  if (input.barcode !== undefined) {
    updates.push('barcode = ?');
    values.push(input.barcode ? String(input.barcode).trim() : null);
  }
  if (updates.length === 0)
    return falla(c, 400, 'No hay nada que actualizar', 'PANTRY_PRODUCT_NOTHING_TO_UPDATE');

  updates.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  const fila = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as FilaIngrediente;
  const nombres = new Map(
    listCategories(db, casa).map((categoria) => [categoria.key, categoria.name])
  );
  return c.json({ success: true, data: productoDe(fila, nombres) });
});

pantryRoutes.get('/products/:id/delete-impact', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const fila = productoO404(db, casa, c.req.param('id'));
  if (!fila) return falla(c, 404, 'El producto no existe en esta casa', 'PANTRY_PRODUCT_NOT_FOUND');
  return c.json({ success: true, data: impactoProducto(db, fila, casa.userId) });
});

pantryRoutes.delete('/products/:id', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const fila = productoO404(db, casa, c.req.param('id'));
  if (!fila) return falla(c, 404, 'El producto no existe en esta casa', 'PANTRY_PRODUCT_NOT_FOUND');
  const impacto = impactoProducto(db, fila, casa.userId);
  if (impacto.quantity > 0) {
    return falla(
      c,
      409,
      'Este producto tiene unidades dentro de la despensa: quitale el stock primero',
      'PANTRY_PRODUCT_IN_PANTRY',
      { quantity: impacto.quantity, unit: fila.unit }
    );
  }
  // Se borra la ficha, no la historia: las lineas de cesta y las observaciones de precio guardan su copia
  // del nombre y de la clave, y una casa no pierde lo que compro porque alguien quite un basico del catalogo.
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(fila.id);
  return c.body(null, 204);
});

function revisarLote(db: ReturnType<typeof getDatabase>, casa: Casa, ids: string[]) {
  const bloques: unknown[] = [];
  const borrables: string[] = [];
  for (const id of ids) {
    const fila = productoO404(db, casa, id);
    if (!fila) continue; // un id que no es de la casa no cuenta: ni se borra ni se llora
    const impacto = impactoProducto(db, fila, casa.userId);
    if (impacto.canDelete) borrables.push(id);
    else bloques.push(impacto);
  }
  return { bloques, borrables };
}

pantryRoutes.post('/products/bulk-delete-impact', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const { ids } = bulkProductIdsSchema.parse(await c.req.json());
  const { bloques, borrables } = revisarLote(db, casa, ids);
  return c.json({
    success: true,
    data: {
      requestedCount: ids.length,
      deletableIds: borrables,
      blocked: bloques,
      canDelete: bloques.length === 0 && borrables.length > 0
    }
  });
});

pantryRoutes.post('/products/bulk-delete', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  const { ids } = bulkProductIdsSchema.parse(await c.req.json());
  const { bloques, borrables } = revisarLote(db, casa, ids);
  if (bloques.length > 0) {
    // Todo o nada: un lote que borra «la mitad» deja una casa con la seleccion a medias y sin forma de saber
    // cuales se fueron. Se rechaza el lote entero y se dice cuales estorban.
    return falla(
      c,
      409,
      `${bloques.length} de ${ids.length} productos tienen unidades dentro de la despensa`,
      'PANTRY_PRODUCT_BULK_DELETE_BLOCKED',
      { blocked: bloques }
    );
  }
  const borrar = db.transaction((lista: string[]) => {
    const stmt = db.prepare('DELETE FROM ingredients WHERE id = ?');
    for (const id of lista) stmt.run(id);
    return lista.length;
  });
  return c.json({ success: true, data: { deleted: borrar(borrables) } });
});

// ═══════════════════════════════════════════════════════════════════
// El catalogo pre-registrado del super (HOGARIA-SPEC ## 12aa)
// ═══════════════════════════════════════════════════════════════════
//
// El catalogo es dato de fabrica en memoria (`utils/supermarket-catalog.ts`), no una tabla: copiarlo a SQL
// convertiria cada producto nuevo en una migracion para actualizar la copia. Lo unico que se persiste es lo
// que la persona anade, que pasa a ser una fila de `ingredients` con su categoria —con su padre delante, que
// es la relacion que el pre-registro tenia que respetar por contrato—.

const NOMBRES_POR_CLAVE = new Map(CATALOGO_CATEGORIAS.map((cat) => [cat.key, cat]));

/**
 * Garantiza que la hoja del catalogo existe como categoria de la casa, y su padre ANTES que ella
 * (`createCategory` comprueba la profundidad sobre el arbol resultante, y un hijo sin padre no cabe).
 * Devuelve cuantas filas nuevas escribe —0, 1 (la hoja) o 2 (padre y hoja)—.
 */
function garantizarCategoriaDelCatalogo(
  db: ReturnType<typeof getDatabase>,
  casa: Casa,
  claveHoja: string
): number {
  let creadas = 0;
  const hoja = NOMBRES_POR_CLAVE.get(claveHoja);
  if (!hoja) return 0;
  if (hoja.parent) {
    const padre = NOMBRES_POR_CLAVE.get(hoja.parent);
    if (padre && !findCategoryByKey(db, casa, padre.key)) {
      createCategory(db, {
        userId: casa.userId,
        householdId: casa.householdId,
        key: padre.key,
        name: padre.name,
        color: padre.color,
        parentKey: null,
        idFactory: nanoid
      });
      creadas += 1;
    }
  }
  if (!findCategoryByKey(db, casa, hoja.key)) {
    createCategory(db, {
      userId: casa.userId,
      householdId: casa.householdId,
      key: hoja.key,
      name: hoja.name,
      color: hoja.color,
      parentKey: hoja.parent ?? null,
      idFactory: nanoid
    });
    creadas += 1;
  }
  return creadas;
}

// GET /api/pantry/catalog/categories — el arbol plano, con su cuenta. El cliente se monta el arbol: son 38 filas.
pantryRoutes.get('/catalog/categories', async (c) => {
  const db = getDatabase();
  const casa = scopeDePantry(c.get('userId'));
  ensureDefaultCategories(db, casa.userId, casa.householdId);
  const conteo = conteoPorHoja();
  const datos = CATALOGO_CATEGORIAS.map((cat) => ({
    ...cat,
    // La cuenta del padre es la suma de sus hojas: lo que el arbol ensena es lo que el filtro va a responder.
    productCount:
      cat.parent === null
        ? CATALOGO_CATEGORIAS.reduce(
            (total, hoja) =>
              hoja.parent === cat.key ? total + (conteo.get(hoja.key) ?? 0) : total,
            0
          )
        : (conteo.get(cat.key) ?? 0)
  }));
  return c.json({ success: true, data: datos });
});

// GET /api/pantry/catalog/products — busqueda normalizada, subarbol opcional y marca de «esto ya es tuyo».
pantryRoutes.get('/catalog/products', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const q = catalogFilterSchema.parse(c.req.query());
  const scope = getUserScope(userId);
  // El `formField` del contrato admite el hueco como `null` (las query strings vacias lo producen); el buscador
  // en memoria quiere `undefined`, y `?? undefined` es la traduccion honesta, no un `as`.
  const { productos, total } = buscarProductos({
    q: q.q ?? undefined,
    category: q.category ?? undefined,
    limit: q.limit,
    offset: q.offset
  });

  // `inHousehold` con la MISMA clave que usa el gestor (`productKeyOf` sobre el nombre), no un LIKE: dos
  // nombres que se parecen no son la misma fila, y decir «ya lo tienes» por parecerse es peor que callarselo.
  const clavesDeCasa = new Set(
    (
      db
        .prepare(`SELECT name FROM ingredients WHERE ${scope.userClause}`)
        .all(...scope.userParams) as { name: string }[]
    ).map((fila) => productKeyOf(fila.name))
  );

  const data = productos.map((producto) => ({
    ...producto,
    categoryLabel: NOMBRES_POR_CLAVE.get(producto.category)?.name ?? producto.category,
    inHousehold: clavesDeCasa.has(productKeyOf(producto.name))
  }));
  return c.json({
    success: true,
    data,
    meta: { total, limit: q.limit, offset: q.offset },
    hasMore: q.offset + data.length < total
  });
});

// POST /api/pantry/catalog/add — de la estanteria a casa, con su categoria y su padre.
pantryRoutes.post('/catalog/add', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const casa = scopeDePantry(userId);
  const { ids } = catalogAddSchema.parse(await c.req.json());
  const unicos = [...new Set(ids)];

  // Validacion total antes de escribir nada: un lote a medias es la clase de estado que nadie sabe arreglar
  // (el mismo criterio del `bulk-delete` de productos).
  const desconocidos = unicos.filter((id) => !productoPorId(id));
  if (desconocidos.length > 0) {
    return falla(
      c,
      400,
      `${desconocidos.length} id(s) no existen en el catalogo`,
      'PANTRY_CATALOG_ID_UNKNOWN',
      { unknownIds: desconocidos }
    );
  }

  ensureDefaultCategories(db, casa.userId, casa.householdId);

  const resultado = db.transaction(() => {
    let anadidos = 0;
    let saltados = 0;
    let categoriasCreadas = 0;
    const imageSearchIds: string[] = [];
    for (const id of unicos) {
      const producto = productoPorId(id)!;
      categoriasCreadas += garantizarCategoriaDelCatalogo(db, casa, producto.category);
      const categoria = findCategoryByKey(db, casa, producto.category)
        ? producto.category
        : PROTECTED_PANTRY_KEY;

      const existente = buscarPorClave(db, casa, producto.name);
      if (existente) {
        if (Number(existente.quantity) > 0) {
          saltados += 1; // ya esta en casa: el catalogo no repone stock a nadie, eso es del visor
          continue;
        }
        // Lo que la casa conocia sin tenerlo pasa a tenerlo: la ficha no se duplica, sube a 1.
        db.prepare(
          'UPDATE ingredients SET quantity = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(existente.id);
        imageSearchIds.push(existente.id);
        anadidos += 1;
        continue;
      }
      // `aliases` es NOT NULL con default: la ruta de productos siempre escribe JSON, y esta tambien —'[]'
      // es «sin alias», NULL es una fila que no se puede insertar.
      const ingredientId = nanoid();
      db.prepare(
        `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, expiration_date, location, image, barcode, notes, aliases)
         VALUES (?, ?, ?, ?, ?, 1, ?, NULL, 'pantry', NULL, NULL, NULL, '[]')`
      ).run(ingredientId, userId, casa.householdId, producto.name, categoria, producto.unit);
      imageSearchIds.push(ingredientId);
      anadidos += 1;
    }
    return { anadidos, saltados, categoriasCreadas, imageSearchIds };
  })();

  for (const ingredientId of resultado.imageSearchIds)
    enqueueIngredientPhoto(db, userId, ingredientId);

  return c.json({
    success: true,
    data: {
      added: resultado.anadidos,
      skipped: resultado.saltados,
      categoriesCreated: resultado.categoriasCreadas
    }
  });
});
