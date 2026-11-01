import type { Page } from '@playwright/test';
import { expect } from '../fixtures';

const TOKEN_KEY = 'hogar:v1:auth_token';

export interface SyntheticRecipe {
  id: string;
  name: string;
  token: string;
}

export interface SyntheticRecipeOptions {
  name?: string;
  totalTime?: number;
  tips?: string;
  warning?: string;
  steps?: Array<{ stepNumber: number; instruction: string; tips?: string; warning?: string }>;
  servings?: number;
  calories?: number;
  restTime?: number | null;
  ingredients?: Array<{
    name: string;
    quantity: number;
    unit: string;
    preparation?: string | null;
    isOptional?: boolean;
    substitutes?: string[];
    notes?: string | null;
  }>;
  utensils?: string[];
  guidance?: {
    appliances: string[];
    parallelTasks: string[];
    tipsAndVariations: string[];
    batchCookingWarning?: string | null;
  };
  instructionsByLevel?: {
    basic: Array<Record<string, unknown>>;
    intermediate: Array<Record<string, unknown>>;
    expert: Array<Record<string, unknown>>;
  };
  nutrition?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number | null;
    sugar?: number;
    sodium?: number;
  };
  storage?: {
    method: string;
    container?: string | null;
    duration: string;
    reheatingInstructions?: string | null;
    freezingPossible: boolean;
    freezingDuration?: string | null;
  };
}

export async function createSyntheticRecipe(
  page: Page,
  options: SyntheticRecipeOptions = {}
): Promise<SyntheticRecipe> {
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  if (!token) throw new Error('la sesión de prueba debe estar autenticada');

  const name = options.name ?? `Receta QA ${Date.now()}`;
  const response = await page.request.post('/api/recipes', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name,
      description: 'Fixture sintético para comprobar navegación y deep links.',
      difficulty: 'easy',
      totalTime: options.totalTime ?? 15,
      prepTime: 5,
      cookTime: 10,
      servings: options.servings ?? 2,
      calories: options.calories,
      restTime: options.restTime,
      ingredients: options.ingredients ?? [{ name: 'Tomate QA', quantity: 2, unit: 'unit' }],
      utensils: options.utensils ?? [],
      ...(options.guidance ? { guidance: options.guidance } : {}),
      ...(options.instructionsByLevel
        ? { instructionsByLevel: options.instructionsByLevel }
        : {
            steps: options.steps ?? [
              {
                stepNumber: 1,
                instruction: 'Cortar el tomate.',
                ...(options.tips ? { tips: options.tips } : {}),
                ...(options.warning ? { warning: options.warning } : {})
              }
            ]
          }),
      ...(options.nutrition ? { nutrition: options.nutrition } : {}),
      ...(options.storage ? { storage: options.storage } : {})
    }
  });
  expect(
    response.ok(),
    `el alta sintética debe responder 2xx, obtuvo ${response.status()}`
  ).toBeTruthy();
  const body = (await response.json()) as { data: { id: string } };
  return { id: body.data.id, name, token };
}

export async function deleteSyntheticRecipe(page: Page, recipe: SyntheticRecipe): Promise<void> {
  const response = await page.request.delete(`/api/recipes/${recipe.id}`, {
    headers: { authorization: `Bearer ${recipe.token}` }
  });
  expect(response.ok(), 'el fixture de receta propio debe limpiarse').toBeTruthy();
}

export async function waitForStableView(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  await page.waitForFunction(() => {
    if (
      document.getAnimations().some((animation) => {
        const iterations = animation.effect?.getTiming().iterations ?? 1;
        return iterations !== Infinity && animation.playState !== 'finished';
      })
    )
      return false;
    const overlay = document.querySelector<HTMLElement>('.modal-overlay');
    const modal = document.querySelector<HTMLElement>('.modal');
    return (
      !overlay ||
      !modal ||
      (getComputedStyle(overlay).opacity === '1' && getComputedStyle(modal).transform === 'none')
    );
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}
