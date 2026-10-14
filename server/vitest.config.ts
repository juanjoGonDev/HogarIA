import { defineConfig } from 'vitest/config';

/**
 * Cobertura del nucleo del servidor (HOGARIA-SPEC §11c).
 *
 * El umbral es duro y por fichero: ningun fichero de esta lista puede bajar del
 * 70 % en ninguna metrica. Y la lista es una rampa: un fichero entra cuando tiene
 * spec propia, nunca se le excluye para que el numero salga bonito.
 *
 * `src/config/database.ts` entro al cambiar el nombre del fichero de la BD: la
 * adopcion del fichero heredado es logica que puede dejar a alguien sin datos,
 * asi que se pruebo antes de subirla (73 % de ramas; por debajo del 100 % quedan
 * las ramas del bootstrap que estos tests no montan, no codigo sin probar).
 *
 * Hoy quedan fuera, con su prueba atada a la fase que les corresponde:
 *   - src/routes/** (salvo shopping.routes.ts, household.routes.ts, household-plan.routes.ts,
 *     calendar.routes.ts, forgot-password.routes.ts, receipts.routes.ts, recipes.routes.ts,
 *     recipe-images.routes.ts y pantry.routes.ts,
 *     con spec propia) y src/index.ts
 *                             → el resto se prueba de momento con la suite e2e
 *   - src/middleware/** (salvo timestamp, que entro el dia que se escribio),
 *     src/schemas/** (salvo receipts.schema.ts, recipe.schema.ts,
 *     household-plan-assignment.schema.ts y recipe-ai-output.schema.ts), src/utils/log-store.ts,
 *     src/utils/logger.ts      → unidades puras; entran con P1/P2, que es cuando se
 *     escriben sus tests de contrato
 */
const COVERED = [
  'src/routes/shopping.routes.ts',
  'src/routes/household.routes.ts',
  'src/routes/household-meal-planning.routes.ts',
  'src/routes/household-meal-proposals.routes.ts',
  'src/routes/household-meal-consumption.routes.ts',
  'src/routes/household-plan.routes.ts',
  'src/routes/household-tasks.routes.ts',
  'src/routes/calendar.routes.ts',
  'src/routes/forgot-password.routes.ts',
  'src/routes/ai-queue.routes.ts',
  'src/routes/ai.routes.ts',
  'src/routes/recipes.routes.ts',
  'src/middleware/recipe-content-body-limit.middleware.ts',
  'src/routes/pantry-product-images.routes.ts',
  'src/schemas/shopping.schema.ts',
  'src/schemas/receipts.schema.ts',
  'src/schemas/recipe.schema.ts',
  'src/schemas/ai.schema.ts',
  'src/schemas/generated-recipe.schema.ts',
  'src/schemas/recipe-ai-output.schema.ts',
  'src/schemas/recipe-improvement.schema.ts',
  'src/schemas/household-plan.schema.ts',
  'src/schemas/household-plan-assignment.schema.ts',
  'src/schemas/household-meal-planning.schema.ts',
  'src/schemas/household-meal-proposal.schema.ts',
  'src/schemas/household-meal-proposal-request.schema.ts',
  'src/schemas/household-meal-consumption.schema.ts',
  'src/schemas/household-meal-shopping-preview.schema.ts',
  'src/schemas/household-task.schema.ts',
  'src/schemas/household-task-proposal.schema.ts',
  'src/utils/product-key.ts',
  'src/utils/pantry-categories.ts',
  'src/utils/shopping-categories.ts',
  'src/utils/list-discount.ts',
  'src/utils/shopping-events.ts',
  'src/middleware/timestamp.middleware.ts',
  'src/utils/photo-prompt.ts',
  'src/utils/live-hub.ts',
  'src/utils/ai-client.ts',
  'src/utils/ai-output-language.ts',
  'src/utils/ticket-queue.ts',
  'src/utils/ticket-lines-dedup.ts',
  'src/utils/ticket-prompt.ts',
  'src/routes/receipts.routes.ts',
  'src/config/database.ts',
  'src/utils/memory-monitor.ts',
  'src/utils/seed-data.ts',
  'src/utils/taste-profile.ts',
  'src/utils/recipe-book-seed.ts',
  'src/utils/recipe-step-photos.ts',
  'src/utils/recipe-step-videos.ts',
  'src/utils/recipe-step-video-playback-tickets.ts',
  'src/utils/recipe-step-video-persistence.ts',
  'src/utils/recipe-replacement.ts',
  'src/utils/product-image-search.ts',
  'src/routes/recipe-images.routes.ts',
  'src/routes/recipe-step-photos.routes.ts',
  'src/routes/recipe-step-videos.routes.ts',
  'src/routes/pantry.routes.ts',
  'src/utils/week-calendar.ts',
  'src/utils/shared-meal-calendar.store.ts',
  'src/utils/household-meal-consumption.store.ts',
  'src/utils/household-meal-shopping-preview.store.ts',
  'src/utils/household-weekly-schedule.ts',
  'src/utils/household-planning-automation.store.ts',
  'src/utils/household-planning-automation-runs.store.ts',
  'src/utils/household-planning-automation.worker.ts',
  'src/utils/household-planning-automation.scheduler.ts',
  'src/routes/household-planning-automation.routes.ts',
  'src/schemas/household-planning-automation.schema.ts',
  'src/utils/household-context.ts',
  'src/utils/ingredient-match.ts',
  'src/utils/household-plan.store.ts',
  'src/utils/household-meal-planning.store.ts',
  'src/utils/household-meal-proposal.planner.ts',
  'src/utils/household-meal-recipe-catalog.ts',
  'src/utils/household-meal-recipe-catalog-attachment.ts',
  'src/utils/household-meal-recipe-snapshot.ts',
  'src/utils/household-plan-assignment.store.ts',
  'src/utils/household-task.store.ts',
  'src/utils/household-task-proposal-ai.ts',
  'src/utils/household-task-assignment.ts',
  'src/utils/household-plan-ai.ts',
  'src/utils/weekly-plan.ts',
  'src/utils/caducidades.ts',
  'src/schemas/bcrypt-password.schema.ts',
  'src/models/schema.ts',
  'src/config/app.config.ts',
  'tests/support/e2e-isolation.mjs'
];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/support/test-environment.ts'],
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      all: false,
      include: COVERED,
      // `text` para leerla en el CI log, `html` para verla en el navegador y
      // `lcov` para que la consuman las extensiones de VS Code / los informes de PR.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      clean: true,
      thresholds: {
        perFile: true,
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70
      }
    }
  }
});
