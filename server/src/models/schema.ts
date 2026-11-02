import { primaryKey, sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  householdId: text('household_id'),
  cookingLevel: text('cooking_level').default('beginner'),
  preferences: text('preferences').default('{}'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const usersRelations = relations(users, ({ one, many }) => ({
  household: one(households, {
    fields: [users.householdId],
    references: [households.id]
  }),
  ingredients: many(ingredients),
  recipes: many(recipes),
  aiConfigs: many(aiConfigs),
  mealParticipants: many(mealParticipants)
}));

// ═══════════════════════════════════════════════════════════════════
// Households
// ═══════════════════════════════════════════════════════════════════

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').unique().notNull(),
  sharedPantry: integer('shared_pantry', { mode: 'boolean' }).default(true),
  mealPlanningPreferences: text('meal_planning_preferences').notNull().default('{}'),
  aiOwnerUserId: text('ai_owner_user_id'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const householdsRelations = relations(households, ({ many }) => ({
  members: many(users),
  ingredients: many(ingredients),
  aiConfigs: many(aiConfigs),
  calendars: many(weeklyCalendars)
}));

export const householdPlans = sqliteTable('household_plans', {
  householdId: text('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  planJson: text('plan_json').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const householdPlanRevisions = sqliteTable(
  'household_plan_revisions',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    planJson: text('plan_json').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP')
  },
  (table) => [primaryKey({ columns: [table.householdId, table.version] })]
);

export const householdPlanAssignments = sqliteTable('household_plan_assignments', {
  householdId: text('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  assignmentsJson: text('assignments_json').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const householdTaskWeeks = sqliteTable(
  'household_task_weeks',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    weekStart: text('week_start').notNull(),
    version: integer('version').notNull(),
    tasksJson: text('tasks_json').notNull(),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
    updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
  },
  (table) => [primaryKey({ columns: [table.householdId, table.weekStart] })]
);

// ═══════════════════════════════════════════════════════════════════
export const householdPlanningAutomations = sqliteTable('household_planning_automations', {
  householdId: text('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  mode: text('mode'),
  scopesJson: text('scopes_json').notNull().default('[]'),
  weekday: integer('weekday'),
  localTime: text('local_time'),
  timeZone: text('time_zone'),
  version: integer('version').notNull(),
  authorizedBy: text('authorized_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});
// Ingredients (Pantry)
// ═══════════════════════════════════════════════════════════════════

export const ingredients = sqliteTable('ingredients', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  householdId: text('household_id'),
  name: text('name').notNull(),
  category: text('category').notNull(),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull(),
  expirationDate: text('expiration_date'),
  location: text('location').default('pantry'),
  image: text('image'),
  barcode: text('barcode'),
  notes: text('notes'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const ingredientsRelations = relations(ingredients, ({ one }) => ({
  user: one(users, {
    fields: [ingredients.userId],
    references: [users.id]
  }),
  household: one(households, {
    fields: [ingredients.householdId],
    references: [households.id]
  })
}));

// ═══════════════════════════════════════════════════════════════════
// Utensils
// ═══════════════════════════════════════════════════════════════════

export const utensils = sqliteTable('utensils', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  householdId: text('household_id'),
  name: text('name').notNull(),
  category: text('category').notNull(),
  available: integer('available', { mode: 'boolean' }).default(true),
  notes: text('notes'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP')
});

export const utensilsRelations = relations(utensils, ({ one }) => ({
  user: one(users, {
    fields: [utensils.userId],
    references: [users.id]
  })
}));

// ═══════════════════════════════════════════════════════════════════
// Recipes
// ═══════════════════════════════════════════════════════════════════

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  difficulty: text('difficulty').default('medium'),
  cuisine: text('cuisine'),
  countryCode: text('country_code'),
  catalogKey: text('catalog_key'),
  sourceAttribution: text('source_attribution'),
  mealType: text('meal_type').default('[]'),
  totalTime: integer('total_time'),
  prepTime: integer('prep_time'),
  cookTime: integer('cook_time'),
  restTime: integer('rest_time'),
  servings: integer('servings').default(2),
  calories: real('calories'),
  image: text('image'),
  ingredients: text('ingredients').default('[]'),
  utensils: text('utensils').default('[]'),
  steps: text('steps').default('[]'),
  recipeGuidance: text('recipe_guidance'),
  nutrition: text('nutrition'),
  storage: text('storage'),
  author: text('author').default('user'),
  authorId: text('author_id'),
  rating: real('rating'),
  timesCooked: integer('times_cooked').default(0),
  tags: text('tags').default('[]'),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false),
  isPublic: integer('is_public', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  author: one(users, {
    fields: [recipes.authorId],
    references: [users.id]
  }),
  userRecipes: many(userRecipes)
}));

// ═══════════════════════════════════════════════════════════════════
// User Recipes (favorites, history)
// ═══════════════════════════════════════════════════════════════════

export const userRecipes = sqliteTable('user_recipes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  recipeId: text('recipe_id').notNull(),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false),
  timesCooked: integer('times_cooked').default(0),
  lastCookedAt: text('last_cooked_at'),
  rating: integer('rating'),
  notes: text('notes'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const userRecipesRelations = relations(userRecipes, ({ one }) => ({
  user: one(users, {
    fields: [userRecipes.userId],
    references: [users.id]
  }),
  recipe: one(recipes, {
    fields: [userRecipes.recipeId],
    references: [recipes.id]
  })
}));

// ═══════════════════════════════════════════════════════════════════
// Weekly Calendars
// ═══════════════════════════════════════════════════════════════════

export const weeklyCalendars = sqliteTable('weekly_calendars', {
  id: text('id').primaryKey(),
  // NULL = calendario personal (sin hogar). Ver la migración en config/database.ts.
  householdId: text('household_id'),
  userId: text('user_id').notNull(),
  weekStart: text('week_start').notNull(),
  weekEnd: text('week_end').notNull(),
  goals: text('goals').default('{}'),
  generatedBy: text('generated_by').default('user'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const weeklyCalendarsRelations = relations(weeklyCalendars, ({ one, many }) => ({
  household: one(households, {
    fields: [weeklyCalendars.householdId],
    references: [households.id]
  }),
  user: one(users, {
    fields: [weeklyCalendars.userId],
    references: [users.id]
  }),
  meals: many(meals)
}));

// ═══════════════════════════════════════════════════════════════════
// Meals
// ═══════════════════════════════════════════════════════════════════

export const meals = sqliteTable('meals', {
  id: text('id').primaryKey(),
  calendarId: text('calendar_id').notNull(),
  date: text('date').notNull(),
  mealType: text('meal_type').notNull(),
  recipeId: text('recipe_id'),
  customMeal: text('custom_meal'),
  time: text('time'),
  servings: integer('servings').default(1),
  notes: text('notes'),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  completedAt: text('completed_at'),
  sourceProposalId: text('source_proposal_id'),
  proposalId: text('proposal_id'),
  recipeSnapshot: text('recipe_snapshot'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP')
});

export const mealsRelations = relations(meals, ({ one, many }) => ({
  calendar: one(weeklyCalendars, {
    fields: [meals.calendarId],
    references: [weeklyCalendars.id]
  }),
  recipe: one(recipes, {
    fields: [meals.recipeId],
    references: [recipes.id]
  }),
  participants: many(mealParticipants)
}));

export const mealParticipants = sqliteTable(
  'meal_participants',
  {
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP')
  },
  (table) => [primaryKey({ columns: [table.mealId, table.userId] })]
);

export const mealParticipantsRelations = relations(mealParticipants, ({ one }) => ({
  meal: one(meals, {
    fields: [mealParticipants.mealId],
    references: [meals.id]
  }),
  user: one(users, {
    fields: [mealParticipants.userId],
    references: [users.id]
  })
}));

// ═══════════════════════════════════════════════════════════════════
// Shared meal consumption and idempotent inventory ledger
// ═══════════════════════════════════════════════════════════════════

export const mealConsumptions = sqliteTable('meal_consumptions', {
  mealId: text('meal_id')
    .primaryKey()
    .references(() => meals.id, { onDelete: 'cascade' }),
  householdId: text('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  servings: integer('servings').notNull(),
  version: integer('version').notNull(),
  recordedBy: text('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  warningsJson: text('warnings_json').notNull().default('[]'),
  recipeSnapshotHash: text('recipe_snapshot_hash'),
  recordedAt: text('recorded_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const mealConsumptionDeductions = sqliteTable(
  'meal_consumption_deductions',
  {
    mealId: text('meal_id')
      .notNull()
      .references(() => mealConsumptions.mealId, { onDelete: 'cascade' }),
    lineIndex: integer('line_index').notNull(),
    ingredientId: text('ingredient_id').references(() => ingredients.id, { onDelete: 'set null' }),
    ingredientName: text('ingredient_name').notNull(),
    unit: text('unit').notNull(),
    targetQuantity: real('target_quantity').notNull(),
    deductedQuantity: real('deducted_quantity').notNull(),
    updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
  },
  (table) => [primaryKey({ columns: [table.mealId, table.lineIndex] })]
);

export const mealInventoryMovements = sqliteTable(
  'meal_inventory_movements',
  {
    id: text('id').primaryKey(),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    consumptionVersion: integer('consumption_version').notNull(),
    lineIndex: integer('line_index').notNull(),
    ingredientId: text('ingredient_id').references(() => ingredients.id, { onDelete: 'set null' }),
    ingredientName: text('ingredient_name').notNull(),
    unit: text('unit').notNull(),
    deltaQuantity: real('delta_quantity').notNull(),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP')
  },
  (table) => [
    uniqueIndex('idx_meal_inventory_movement_once').on(
      table.mealId,
      table.consumptionVersion,
      table.lineIndex
    )
  ]
);

// ═══════════════════════════════════════════════════════════════════
// AI Configurations
// ═══════════════════════════════════════════════════════════════════

export const aiConfigs = sqliteTable('ai_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  householdId: text('household_id').references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  provider: text('provider').default('custom'),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  model: text('model').notNull(),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(2000),
  topP: real('top_p'),
  frequencyPenalty: real('frequency_penalty'),
  presencePenalty: real('presence_penalty'),
  timeout: integer('timeout').default(30000),
  retryAttempts: integer('retry_attempts').default(3),
  concurrency: integer('concurrency').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastTested: text('last_tested'),
  testStatus: text('test_status'),
  testError: text('test_error'),
  testStartedAt: text('test_started_at'),
  testLatencyMs: integer('test_latency_ms'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP')
});

export const aiConfigsRelations = relations(aiConfigs, ({ one }) => ({
  user: one(users, {
    fields: [aiConfigs.userId],
    references: [users.id]
  }),
  household: one(households, {
    fields: [aiConfigs.householdId],
    references: [households.id]
  })
}));

/** Metadata only: non-ticket request bodies, prompts and attachments intentionally stay in memory. */
export const aiJobs = sqliteTable('ai_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  householdId: text('household_id'),
  configId: text('config_id'),
  kind: text('kind').notNull().default('receipt'),
  receiptId: text('receipt_id'),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  queueOrder: integer('queue_order').notNull().default(0),
  claimGeneration: integer('claim_generation').notNull().default(0),
  leaseUntil: text('lease_until'),
  errorCode: text('error_code'),
  errorDetail: text('error_detail'),
  providerResponseId: text('provider_response_id'),
  providerTransport: text('provider_transport'),
  providerHttpStatus: integer('provider_http_status'),
  providerErrorType: text('provider_error_type'),
  providerErrorCode: text('provider_error_code'),
  providerErrorParam: text('provider_error_param'),
  elapsedMs: integer('elapsed_ms'),
  diagnosticStage: text('diagnostic_stage'),
  dismissedAt: text('dismissed_at'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at')
});
