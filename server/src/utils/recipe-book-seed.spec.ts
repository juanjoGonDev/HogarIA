import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type RecipeBook = typeof import('./recipe-book-seed.js');
type RecipeSchema = typeof import('../schemas/recipe.schema.js');
let db: Sql;
let closeDatabase: () => void;
let book: RecipeBook;
let recipeSchemas: RecipeSchema;

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  book = await import('./recipe-book-seed.js');
  recipeSchemas = await import('../schemas/recipe.schema.js');
});

beforeEach(() => {
  const keys = book.RECIPE_BOOK_SEEDS.map(({ catalogKey }) => catalogKey);
  db.prepare(`DELETE FROM user_recipes WHERE recipe_id IN (${keys.map(() => '?').join(',')})`).run(
    ...book.RECIPE_BOOK_SEEDS.map(({ id }) => id)
  );
  book.removeUnusedRecipeBookCatalog(db);
  book.ensureRecipeBookCatalog(db);
});

afterEach(() => {
  db.prepare('DELETE FROM user_recipes WHERE user_id IN (?, ?)').run(
    'recipe-seed-owner',
    'recipe-book-favorite-user'
  );
  db.prepare('DELETE FROM recipes WHERE id = ? AND author_id = ?').run(
    'recipe-catalog-es-tortilla-patatas',
    'recipe-seed-owner'
  );
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(
    'recipe-seed-owner',
    'recipe-book-favorite-user'
  );
});

afterAll(() => closeDatabase?.());

describe('catálogo editorial de recetas', () => {
  it('siembra seis platos por país una sola vez, con país, tipo y origen explícitos', () => {
    expect(book.RECIPE_BOOK_SEEDS.filter((recipe) => recipe.countryCode === 'ES')).toHaveLength(6);
    expect(book.RECIPE_BOOK_SEEDS.filter((recipe) => recipe.countryCode === 'SV')).toHaveLength(6);
    expect(book.ensureRecipeBookCatalog(db)).toBe(0);

    const counts = db
      .prepare(
        "SELECT country_code, COUNT(*) AS count FROM recipes WHERE author = 'catalog' GROUP BY country_code"
      )
      .all() as { country_code: string; count: number }[];
    expect(counts).toEqual(
      expect.arrayContaining([
        { country_code: 'ES', count: 6 },
        { country_code: 'SV', count: 6 }
      ])
    );

    const independentCuisine = db
      .prepare('SELECT country_code, cuisine FROM recipes WHERE id = ?')
      .get('recipe-catalog-sv-riguas') as { country_code: string; cuisine: string };
    expect(independentCuisine).toEqual({ country_code: 'SV', cuisine: 'salvadoreña' });
  });

  it('guarda ingredientes una vez, los tres niveles completos, atribución y ninguna imagen ficticia', () => {
    const recipe = db
      .prepare('SELECT * FROM recipes WHERE id = ?')
      .get('recipe-catalog-es-tortilla-patatas') as Record<string, unknown>;
    const ingredients = JSON.parse(recipe.ingredients as string);
    const instructions = JSON.parse(recipe.steps as string);
    const source = JSON.parse(recipe.source_attribution as string);

    expect(recipe.image).toBeNull();
    expect(ingredients.length).toBeGreaterThan(1);
    expect(instructions).toEqual(
      expect.objectContaining({
        basic: expect.any(Array),
        intermediate: expect.any(Array),
        expert: expect.any(Array)
      })
    );
    expect(instructions.basic[0].stepNumber).toBe(1);
    expect(instructions.intermediate[1].stepNumber).toBe(2);
    expect(source).toMatchObject({
      publisher: expect.any(String),
      title: expect.any(String),
      url: expect.stringMatching(/^https:\/\//)
    });
  });

  it('cada seed cumple el contrato de receta con ingredientes comunes y tres niveles', () => {
    for (const recipe of book.RECIPE_BOOK_SEEDS) {
      const result = recipeSchemas.createRecipeSchema.safeParse({
        name: recipe.name,
        description: recipe.description,
        difficulty: recipe.difficulty,
        cuisine: recipe.cuisine,
        countryCode: recipe.countryCode,
        mealType: recipe.mealType,
        totalTime: recipe.totalTime,
        prepTime: recipe.prepTime,
        cookTime: recipe.cookTime,
        restTime: recipe.restTime,
        servings: recipe.servings,
        calories: recipe.calories,
        ingredients: recipe.ingredients,
        utensils: recipe.utensils,
        instructionsByLevel: recipe.instructionsByLevel,
        guidance: recipe.guidance,
        nutrition: recipe.nutrition,
        storage: recipe.storage,
        tags: recipe.tags
      });

      expect(result.success, `${recipe.id} must satisfy createRecipeSchema`).toBe(true);
    }
  });

  it('presenta los niveles del catálogo de más guía principiante a más concisión experta', () => {
    const wordCount = (steps: { instruction: string }[]) =>
      steps.reduce((total, step) => total + step.instruction.trim().split(/\s+/).length, 0);

    for (const recipe of book.RECIPE_BOOK_SEEDS) {
      const levels = recipe.instructionsByLevel;
      expect(levels.basic.length, `${recipe.name}: pasos de Principiante`).toBeGreaterThan(
        levels.expert.length
      );
      expect(wordCount(levels.basic), `${recipe.name}: detalle de Principiante`).toBeGreaterThan(
        wordCount(levels.intermediate)
      );
      expect(
        wordCount(levels.intermediate),
        `${recipe.name}: detalle de Intermedio`
      ).toBeGreaterThan(wordCount(levels.expert));
    }
  });

  it('cada receta del libro guarda una ficha completa y pasos útiles en los tres niveles', () => {
    const allowedAppliances = new Set([
      'Freidora de aire / mini horno (máximo 200 °C)',
      'Microondas LG inverter',
      'Cocina de gas',
      'Batidora',
      'Frigorífico',
      'Tostadora',
      'Grill / prensa para sándwiches',
      'Freidora de aceite'
    ]);

    for (const seed of book.RECIPE_BOOK_SEEDS) {
      const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(seed.id) as Record<
        string,
        unknown
      >;
      const levels = JSON.parse(row.steps as string) as Record<
        'basic' | 'intermediate' | 'expert',
        Array<{ instruction: string; stepNumber: number }>
      >;
      const guidance = JSON.parse(row.recipe_guidance as string) as {
        appliances: string[];
        parallelTasks: string[];
        tipsAndVariations: string[];
      };
      const nutrition = JSON.parse(row.nutrition as string) as Record<string, number>;
      const storage = JSON.parse(row.storage as string) as {
        method: string;
        container: string;
        duration: string;
        reheatingInstructions: string;
        freezingPossible: boolean;
        freezingDuration: string | null;
      };

      expect(Number(row.calories), `${seed.id} needs estimated kcal per serving`).toBeGreaterThan(
        0
      );
      expect(
        Number(row.rest_time),
        `${seed.id} needs rest time, including zero`
      ).toBeGreaterThanOrEqual(0);
      expect(
        Number(row.total_time),
        `${seed.id} total time must include its stages`
      ).toBeGreaterThanOrEqual(
        Number(row.prep_time) + Number(row.cook_time) + Number(row.rest_time)
      );
      expect(nutrition.calories).toBe(Number(row.calories));
      expect(nutrition).toEqual(
        expect.objectContaining({
          protein: expect.any(Number),
          carbs: expect.any(Number),
          fat: expect.any(Number)
        })
      );
      expect(
        seed.ingredients.some(
          (ingredient) => ingredient.isOptional || ingredient.substitutes?.length
        ),
        `${seed.id} should offer a practical optional item or substitute`
      ).toBe(true);
      expect(
        guidance.appliances.length,
        `${seed.id} needs its required appliances`
      ).toBeGreaterThan(0);
      expect(guidance.appliances.every((appliance) => allowedAppliances.has(appliance))).toBe(true);
      expect(
        guidance.parallelTasks.length,
        `${seed.id} needs a safe parallel task when one is useful`
      ).toBeGreaterThan(0);
      expect(
        guidance.tipsAndVariations.length,
        `${seed.id} needs useful variations`
      ).toBeGreaterThan(0);
      expect(storage.method).toBeTruthy();
      expect(storage.container).toBeTruthy();
      expect(storage.duration).toBeTruthy();
      expect(storage.reheatingInstructions).toBeTruthy();
      expect(storage.freezingPossible).toBeTypeOf('boolean');
      if (storage.freezingPossible) expect(storage.freezingDuration).toBeTruthy();

      for (const level of ['basic', 'intermediate', 'expert'] as const) {
        const steps = levels[level];
        expect(
          steps.length,
          `${seed.id}/${level} should contain at least four steps`
        ).toBeGreaterThanOrEqual(4);
        expect(steps.map((entry) => entry.stepNumber)).toEqual(steps.map((_, index) => index + 1));
        expect(steps.every((entry) => entry.instruction.length >= 35)).toBe(true);
        expect(
          /lav|enjuag|no hace falta lavar/i.test(steps[0].instruction),
          `${seed.id}/${level} must start with washing guidance`
        ).toBe(true);
      }
    }
  });

  it('atribuye las riguas a una fuente pública vigente del Ministerio de Educación', () => {
    const riguas = book.RECIPE_BOOK_SEEDS.find(
      (recipe) => recipe.id === 'recipe-catalog-sv-riguas'
    );

    expect(riguas?.sourceAttribution).toMatchObject({
      publisher: 'Ministerio de Educación de El Salvador',
      url: 'https://www.mined.gob.sv/descarga/programas-estudio/libro_4_sociales_0_.pdf'
    });
  });

  it('no duplica seeds y no sobrescribe una fila de usuario que coincida con un id estable', () => {
    const victimId = 'recipe-catalog-es-tortilla-patatas';
    db.prepare('DELETE FROM recipes WHERE id = ?').run(victimId);
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      'recipe-seed-owner',
      'recipe-seed-owner@test.local',
      'Seed owner',
      'synthetic-hash'
    );
    db.prepare(
      'INSERT INTO recipes (id, name, author, author_id, country_code) VALUES (?, ?, ?, ?, ?)'
    ).run(victimId, 'Mi receta no sustituible', 'user', 'recipe-seed-owner', 'SV');

    expect(book.ensureRecipeBookCatalog(db)).toBe(0);
    expect(
      db
        .prepare('SELECT name, author, country_code FROM recipes WHERE id = ?')
        .get(victimId) as Record<string, string>
    ).toEqual({ name: 'Mi receta no sustituible', author: 'user', country_code: 'SV' });
  });

  it('refresca contenido editorial viejo sin tocar portada ni datos personales', () => {
    const recipeId = 'recipe-catalog-es-tortilla-patatas';
    const cover = 'https://assets.example.test/recipe-cover.webp';
    const seed = book.RECIPE_BOOK_SEEDS.find((recipe) => recipe.id === recipeId)!;

    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      'recipe-book-favorite-user',
      'recipe-book-favorite@test.local',
      'Book favorite',
      'synthetic-hash'
    );
    db.prepare(
      'INSERT INTO user_recipes (id, user_id, recipe_id, is_favorite, times_cooked, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('recipe-book-favorite', 'recipe-book-favorite-user', recipeId, 1, 3, 'Mi nota');
    db.prepare(
      'UPDATE recipes SET description = ?, calories = NULL, steps = ?, image = ?, is_favorite = 1, rating = 5, times_cooked = 7 WHERE id = ?'
    ).run('Contenido editorial antiguo', '[]', cover, recipeId);

    expect(book.ensureRecipeBookCatalog(db)).toBe(0);

    const refreshed = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as Record<
      string,
      unknown
    >;
    const levels = JSON.parse(refreshed.steps as string) as Record<string, unknown[]>;
    expect(refreshed).toMatchObject({
      author: 'catalog',
      description: seed.description,
      calories: seed.calories,
      image: cover,
      is_favorite: 1,
      rating: 5,
      times_cooked: 7
    });
    expect(levels.basic).toHaveLength(seed.instructionsByLevel.basic.length + 3);
    expect(
      db
        .prepare('SELECT is_favorite, times_cooked, notes FROM user_recipes WHERE id = ?')
        .get('recipe-book-favorite')
    ).toEqual({ is_favorite: 1, times_cooked: 3, notes: 'Mi nota' });
  });

  it('permite retirar seeds sin referencias y conserva las que tienen notas/favoritos personales', () => {
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      'recipe-book-favorite-user',
      'recipe-book-favorite@test.local',
      'Book favorite',
      'synthetic-hash'
    );
    db.prepare(
      'INSERT INTO user_recipes (id, user_id, recipe_id, is_favorite, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(
      'recipe-book-favorite',
      'recipe-book-favorite-user',
      'recipe-catalog-es-tortilla-patatas',
      1,
      'Mi nota'
    );

    expect(book.removeUnusedRecipeBookCatalog(db)).toBe(11);
    expect(
      (
        db
          .prepare('SELECT name FROM recipes WHERE id = ?')
          .get('recipe-catalog-es-tortilla-patatas') as { name: string }
      ).name
    ).toBe('Tortilla de patatas');
    expect(
      (
        db.prepare('SELECT notes FROM user_recipes WHERE id = ?').get('recipe-book-favorite') as {
          notes: string;
        }
      ).notes
    ).toBe('Mi nota');
  });
});
