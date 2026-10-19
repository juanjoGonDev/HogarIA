import { SimpleChange } from '@angular/core';
import { RecipeCookingViewComponent } from './recipe-cooking-view.component';
import type { Recipe } from '../../shared/models/recipe.model';
import type { RecipeInstructionStep } from '../../shared/models/recipe-instructions';

describe('RecipeCookingViewComponent', () => {
  let component: RecipeCookingViewComponent;

  const recipe = {
    id: 'recipe-synthetic',
    name: 'Receta sintética',
    totalTime: 30,
    servings: 2,
    ingredients: [{ name: 'Arroz', quantity: 200, unit: 'g', isOptional: false }]
  } as Recipe;
  const steps: RecipeInstructionStep[] = [
    {
      stepNumber: 1,
      instruction: 'Enjuagar.',
      timerRequired: true,
      timerDuration: 1
    },
    { stepNumber: 2, instruction: 'Servir.' }
  ];

  beforeEach(() => {
    component = new RecipeCookingViewComponent();
    component.recipe = recipe;
    component.steps = steps;
    component.servings = 2;
  });

  it('scales the stored amount locally for the current number of servings', () => {
    expect(component.scaledQuantity(200)).toBe(200);
    component.servings = 1;
    expect(component.scaledQuantity(200)).toBe(100);
    component.servings = 3;
    expect(component.scaledQuantity(200)).toBe(300);
    component.servings = 20;
    expect(component.scaledQuantity(200)).toBe(2000);
    component.servings = Number.MAX_SAFE_INTEGER;
    expect(component.scaledQuantity(200)).toBe(900719925474099100);
    expect(recipe.ingredients[0].quantity).toBe(200);
  });

  it('scales a normalized one-serving recipe without mutating its base ingredient', () => {
    const oneServingRecipe = {
      ...recipe,
      servings: 1,
      ingredients: [{ name: 'Arroz', quantity: 80, unit: 'g', isOptional: false }]
    } as Recipe;
    component.recipe = oneServingRecipe;
    component.servings = 4;

    expect(component.scaledQuantity(80)).toBe(320);
    expect(oneServingRecipe.ingredients[0].quantity).toBe(80);
  });

  it('emits safe positive integer servings and ignores invalid adjustments', () => {
    const changes: number[] = [];
    component.servingsChange.subscribe((servings) => changes.push(servings));

    component.adjustServings(1);
    component.servings = 1;
    component.adjustServings(-1);
    component.servings = Number.MAX_SAFE_INTEGER;
    component.adjustServings(1);

    expect(changes).toEqual([3]);
  });

  it('accepts safe integer servings and restores empty, fractional and unsafe values', () => {
    const changes: number[] = [];
    component.servingsChange.subscribe((servings) => changes.push(servings));
    const inputs = ['1', '2', '20', String(Number.MAX_SAFE_INTEGER)].map(
      (value) => ({ value }) as HTMLInputElement
    );
    const invalidInputs = ['', '2.5', '-1', String(Number.MAX_SAFE_INTEGER + 1)].map(
      (value) => ({ value }) as HTMLInputElement
    );

    for (const input of inputs) {
      component.setServingsFromInput({ target: input } as unknown as Event);
    }
    for (const input of invalidInputs) {
      component.setServingsFromInput({ target: input } as unknown as Event);
    }

    expect(changes).toEqual([1, 2, 20, Number.MAX_SAFE_INTEGER]);
    expect(invalidInputs.map((input) => input.value)).toEqual(['2', '2', '2', '2']);
  });

  it('tracks completed checklist steps immutably and reports progress', () => {
    const checkbox = (checked: boolean) => ({ target: { checked } }) as unknown as Event;

    expect(component.isStepComplete(0)).toBeFalse();
    component.setStepComplete(0, checkbox(true));
    expect(component.isStepComplete(0)).toBeTrue();
    expect(component.completionPercent()).toBe(50);
    component.setStepComplete(0, checkbox(false));
    expect(component.isStepComplete(0)).toBeFalse();
    component.steps = [];
    expect(component.completionPercent()).toBe(0);
  });

  it('resets step-bound cooking state when the selected instruction level changes', () => {
    const checkbox = (checked: boolean) => ({ target: { checked } }) as unknown as Event;
    component.focusStep(1);
    component.setStepComplete(0, checkbox(true));
    component.onTimerStart(0, steps[0]);
    component.onTimerComplete(0, steps[0]);

    const previousSteps = component.steps;
    const expertSteps = [
      { stepNumber: 1, instruction: 'Templar y detener.', timerRequired: true, timerDuration: 2 }
    ];
    component.steps = expertSteps;
    component.ngOnChanges({ steps: new SimpleChange(previousSteps, expertSteps, false) });

    expect(component.focusedStepIndex()).toBe(0);
    expect(component.completedSteps()).toEqual(new Set<number>());
    expect(component.timerProgress()).toEqual({});
    expect(component.completedTimerStep()).toBeNull();
  });

  it('bounds step navigation and toggles the mobile ingredient disclosure', () => {
    component.focusStep(1);
    expect(component.focusedStepIndex()).toBe(1);
    component.focusStep(-1);
    component.focusStep(2);
    expect(component.focusedStepIndex()).toBe(1);

    expect(component.mobileIngredientsExpanded()).toBeFalse();
    component.toggleMobileIngredients();
    expect(component.mobileIngredientsExpanded()).toBeTrue();
    component.toggleMobileIngredients();
    expect(component.mobileIngredientsExpanded()).toBeFalse();
  });

  it('tracks failed video fallbacks per recipe step and clears only the retried clip', () => {
    const firstVideoStep = { ...steps[0], videoId: 'video-a' };
    const secondVideoStep = { ...steps[1], videoId: 'video-b' };
    component.steps = [firstVideoStep, secondVideoStep];

    component.onStepVideoUnavailable(firstVideoStep);

    expect(component.isStepVideoFailed(firstVideoStep)).toBeTrue();
    expect(component.isStepVideoFailed(secondVideoStep)).toBeFalse();

    component.retryStepVideo(firstVideoStep);

    expect(component.isStepVideoFailed(firstVideoStep)).toBeFalse();
    expect(component.isStepVideoFailed(secondVideoStep)).toBeFalse();
  });

  it('tracks active, paused, reset and completed timers for hidden mobile steps', () => {
    const firstStep = steps[0];
    expect(component.timerDurationSeconds(firstStep)).toBe(60);
    expect(component.timerDurationSeconds(steps[1])).toBe(0);
    expect(component.formatTime(65)).toBe('01:05');

    component.onTimerStart(0, firstStep);
    component.onTimerTick(0, 45);
    expect(component.activeRecipeTimers()).toEqual([
      {
        index: 0,
        stepNumber: 1,
        instruction: 'Enjuagar.',
        currentTime: 45
      }
    ]);

    component.onTimerPause(0);
    expect(component.activeRecipeTimers()[0].currentTime).toBe(45);
    component.onTimerStart(0, firstStep);
    expect(component.activeRecipeTimers()[0].currentTime).toBe(45);
    component.onTimerPause(0);
    component.onTimerComplete(0, firstStep);
    expect(component.completedTimerStep()).toBe(1);
    expect(component.activeRecipeTimers()).toEqual([]);

    component.onTimerStart(0, firstStep);
    component.onTimerReset(0, firstStep);
    expect(component.activeRecipeTimers()).toEqual([]);
    expect(component.completedTimerStep()).toBeNull();
  });

  it('keeps each active timer row keyed to its recipe step across ticks', () => {
    const before = {
      index: 1,
      stepNumber: 2,
      instruction: 'Hervir el caldo.',
      currentTime: 60
    };
    const after = { ...before, currentTime: 59 };

    expect(component.trackActiveRecipeTimer(0, before)).toBe(1);
    expect(component.trackActiveRecipeTimer(0, after)).toBe(1);
  });
});
