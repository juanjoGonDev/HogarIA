import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { HouseholdMealPlannerComponent } from './household-meal-planner.component';
import { HouseholdMealProposalService } from '../../core/services/household-meal-proposal.service';
import type {
  HouseholdMealProposal,
  HouseholdMealProposalConfirmation
} from '../../core/services/household-meal-proposal.service';
import { HouseholdMealShoppingService } from '../../core/services/household-meal-shopping.service';
import type {
  HouseholdMealShoppingApproval,
  HouseholdMealShoppingPreview
} from '../../core/services/household-meal-shopping.service';
import { I18nService } from '../../core/services/i18n.service';
import type { TranslationKey } from '../../core/i18n';
import type { HouseholdMember } from '../../shared/models/household.model';

const members = [member('member-1', 'user-1', 'Alicia'), member('member-2', 'user-2', 'Bruno')];

function member(id: string, userId: string, name: string): HouseholdMember {
  return {
    id,
    userId,
    name,
    email: `${userId}@example.test`,
    role: 'member',
    cookingLevel: 'beginner',
    isActive: true,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    permissions: {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    }
  };
}

function event(
  id: string,
  mealType: 'lunch' | 'dinner',
  aliases: string[],
  participantIds: string[],
  servings: number
): HouseholdMealProposal['events'][number] {
  return {
    id,
    date: '2026-10-12',
    mealType,
    time: mealType === 'lunch' ? '14:00' : '20:30',
    recipeAlias: `R-${id}`,
    participantAliases: aliases,
    participantIds,
    servings,
    objectiveSummary: aliases.length > 1 ? 'Plato compartido.' : 'Plato individual.',
    status: 'scheduled',
    reason: null
  };
}

function proposal(): HouseholdMealProposal {
  const events = [
    event('shared-lunch', 'lunch', ['P1', 'P2'], ['user-1', 'user-2'], 2),
    event('solo-dinner-one', 'dinner', ['P1'], ['user-1'], 1),
    event('solo-dinner-two', 'dinner', ['P2'], ['user-2'], 1)
  ];
  return {
    proposalId: 'proposal-synthetic',
    weekStart: '2026-10-12',
    participants: [
      { alias: 'P1', householdMemberId: 'member-1' },
      { alias: 'P2', householdMemberId: 'member-2' }
    ],
    recipes: events.map((mealEvent, index) => ({
      alias: mealEvent.recipeAlias!,
      source: index === 0 ? 'catalog' : 'new',
      recipeId: index === 0 ? 'recipe-shared' : null,
      recipe: {
        name: mealEvent.id === 'shared-lunch' ? 'Lentejas para compartir' : 'Tortilla individual',
        description: 'Receta sintética de prueba.',
        baseServings: 2,
        difficulty: 'easy',
        cuisine: 'Española',
        totalTime: 30,
        prepTime: 10,
        cookTime: 20,
        restTime: null,
        calories: 250,
        ingredients: [
          {
            name: 'Patata',
            quantity: 100,
            unit: 'g',
            preparation: null,
            isOptional: false,
            substitutes: [],
            notes: null
          }
        ],
        utensils: ['Olla'],
        guidance: {
          appliances: [],
          parallelTasks: [],
          tipsAndVariations: ['Añade perejil al final.'],
          batchCookingWarning: null
        },
        instructionsByLevel: {
          basic: [
            {
              stepNumber: 1,
              instruction: 'Cocinar con el resto de ingredientes.',
              temperature: null,
              timerRequired: true,
              timerDuration: 8,
              duration: 10,
              tips: null,
              warning: null,
              illustration: null
            }
          ],
          intermediate: [
            {
              stepNumber: 1,
              instruction: 'Sofríe y añade los ingredientes.',
              temperature: { value: 180, unit: 'C' },
              timerRequired: true,
              timerDuration: 10,
              duration: 10,
              tips: 'Mantén el fuego medio.',
              warning: null,
              illustration: null
            }
          ],
          expert: [
            {
              stepNumber: 1,
              instruction: 'Controla el punto del sofrito y ajusta la cocción.',
              temperature: { value: 356, unit: 'F' },
              timerRequired: true,
              timerDuration: 3,
              duration: 10,
              tips: null,
              warning: null,
              illustration: null
            }
          ]
        },
        nutrition: { calories: 250, protein: 12, carbs: 30, fat: 8, fiber: 5 },
        storage: null,
        tags: ['sintética']
      }
    })),
    events
  };
}

function currentShoppingPreview(): HouseholdMealShoppingPreview {
  const start = new Date();
  const startDate = start.toISOString().slice(0, 10);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 30);
  return {
    startDate,
    endDate: end.toISOString().slice(0, 10),
    previewId: 'e'.repeat(64),
    sharedPantry: true,
    plannedMealCount: 0,
    requiredIngredients: [],
    optionalIngredients: [],
    warnings: []
  };
}

describe('HouseholdMealPlannerComponent', () => {
  let fixture: ComponentFixture<HouseholdMealPlannerComponent>;
  let component: HouseholdMealPlannerComponent;
  let service: jasmine.SpyObj<HouseholdMealProposalService>;
  let shoppingService: jasmine.SpyObj<HouseholdMealShoppingService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj<HouseholdMealProposalService>('HouseholdMealProposalService', [
      'createProposal',
      'confirmProposal'
    ]);
    shoppingService = jasmine.createSpyObj<HouseholdMealShoppingService>(
      'HouseholdMealShoppingService',
      ['loadPreview', 'approve']
    );
    const i18n = {
      resolved: signal<'es' | 'en'>('es'),
      changeTick: signal(0),
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'household.meal_proposal_servings_for') {
          return `Raciones para ${params?.['meal']}`;
        }
        if (key === 'household.meal_proposal_ingredients') {
          return `Ingredientes para ${params?.['count']} raciones`;
        }
        return key;
      }
    } as unknown as I18nService;

    await TestBed.configureTestingModule({
      imports: [HouseholdMealPlannerComponent],
      providers: [
        provideRouter([]),
        { provide: HouseholdMealProposalService, useValue: service },
        { provide: HouseholdMealShoppingService, useValue: shoppingService },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdMealPlannerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'home-1');
    fixture.componentRef.setInput('canEdit', true);
    fixture.componentRef.setInput('members', members);
    // Proposal fixtures use this week; pin it so tests do not expire after Monday.
    component.setWeekFromInput('2026-10-12');
    fixture.detectChanges();
  });

  it('sends the chosen week and membership IDs, then renders shared and individual assignments', () => {
    const preview = proposal();
    service.createProposal.and.returnValue(of(preview));

    component.setWeekFromInput('2026-10-12');
    component.generateProposal();
    fixture.detectChanges();

    expect(service.createProposal).toHaveBeenCalledOnceWith('home-1', {
      weekStart: '2026-10-12',
      householdMemberIds: ['member-1', 'member-2']
    });
    expect(
      fixture.nativeElement.querySelectorAll('[data-test^="meal-proposal-event-"]').length
    ).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('household.meal_proposal_shared');
    expect(fixture.nativeElement.textContent).toContain('household.meal_proposal_individual');
    expect(fixture.nativeElement.textContent).toContain('Ingredientes para 2 raciones');
    expect(fixture.nativeElement.textContent).toContain('household.meal_proposal_recipe_saved');
    expect(fixture.nativeElement.textContent).toContain('household.meal_proposal_recipe_new');
    expect(fixture.nativeElement.textContent).toContain('Alicia');
    expect(fixture.nativeElement.textContent).toContain('Bruno');
    expect(component.canConfirm()).toBeTrue();
  });

  it('resolves recipe aliases and exposes one accessible instruction level at a time', () => {
    service.createProposal.and.returnValue(of(proposal()));
    component.generateProposal();
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-recipe-details-shared-lunch"]'
    ) as HTMLDetailsElement;
    details.open = true;
    fixture.detectChanges();

    const levelTabs = Array.from(
      fixture.nativeElement.querySelectorAll('[data-test="meal-proposal-recipe-level-basic"]')
    ) as HTMLButtonElement[];
    expect(levelTabs.length).toBe(3);
    const basicTab = levelTabs[0];
    expect(basicTab.getAttribute('role')).toBe('tab');
    expect(basicTab.getAttribute('aria-selected')).toBe('true');
    const intermediateTab = basicTab.parentElement?.querySelector(
      '[data-test="meal-proposal-recipe-level-intermediate"]'
    ) as HTMLButtonElement;
    expect(intermediateTab).not.toBeNull();

    basicTab.focus();
    basicTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();

    const expertTab = basicTab.parentElement?.querySelector(
      '[data-test="meal-proposal-recipe-level-expert"]'
    ) as HTMLButtonElement;
    expect(expertTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(expertTab);
    expect(details.textContent).toContain('Controla el punto del sofrito');
    expect(details.textContent).toContain('household.meal_proposal_utensils');
    expect(details.textContent).toContain('Olla');
    expect(details.textContent).toContain('household.meal_proposal_cook_time');
    expect(details.textContent).toContain('household.meal_proposal_temperature');
    expect(details.textContent).toContain('356 °F');
    expect(details.textContent).toContain('household.meal_proposal_timer');
  });

  it('does not render an empty recipe guidance section', () => {
    const preview = proposal();
    for (const reference of preview.recipes) {
      reference.recipe.guidance = {
        appliances: [],
        parallelTasks: [],
        tipsAndVariations: [],
        batchCookingWarning: null
      };
    }
    service.createProposal.and.returnValue(of(preview));
    component.generateProposal();
    fixture.detectChanges();

    const details = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-recipe-details-shared-lunch"]'
    ) as HTMLDetailsElement;
    details.open = true;
    fixture.detectChanges();

    expect(details.querySelector('.meal-planner__recipe-guidance')).toBeNull();
  });

  it('uses explicit timer duration and does not turn a null timer into a step-duration timer', () => {
    expect(
      component.recipeStepTimerMinutes({
        stepNumber: 1,
        instruction: 'Remover',
        timerRequired: true,
        timerDuration: 3,
        duration: 12
      })
    ).toBe(3);
    expect(
      component.recipeStepTimerMinutes({
        stepNumber: 1,
        instruction: 'Remover',
        timerRequired: true,
        timerDuration: null,
        duration: 12
      })
    ).toBeNull();
    expect(
      component.recipeStepTimerMinutes({
        stepNumber: 1,
        instruction: 'Remover',
        timerRequired: true,
        duration: 12
      })
    ).toBe(12);
  });

  it('scales displayed ingredients locally and confirms servings without changing the base recipe', () => {
    const preview = proposal();
    service.createProposal.and.returnValue(of(preview));
    service.confirmProposal.and.returnValue(
      of({
        proposalId: preview.proposalId,
        weekStart: preview.weekStart,
        idempotent: false,
        events: [],
        unresolvedEvents: []
      })
    );

    component.generateProposal();
    fixture.detectChanges();

    const servingsInput = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-servings-shared-lunch"]'
    ) as HTMLInputElement;
    expect(servingsInput).withContext('review exposes a labeled serving count').not.toBeNull();
    expect(servingsInput.min).toBe('1');
    expect(servingsInput.max).toBe('100');
    expect(servingsInput.step).toBe('1');
    expect(servingsInput.getAttribute('aria-label')).toBe('Raciones para Lentejas para compartir');

    const ingredient = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-ingredient-shared-lunch-0"]'
    ) as HTMLElement;
    expect(ingredient.textContent).toContain('100 g');

    servingsInput.value = '3';
    servingsInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(ingredient.textContent).toContain('150 g');
    expect(service.createProposal).toHaveBeenCalledTimes(1);
    expect(preview.events[0].servings).toBe(2);
    expect(preview.recipes[0].recipe.ingredients[0].quantity).toBe(100);

    component.confirmProposal();
    const request = service.confirmProposal.calls.mostRecent().args[1];
    const submittedEvent = request.events.find((item) => item.id === 'shared-lunch');
    expect(submittedEvent?.servings).toBe(3);
    expect(submittedEvent?.recipeAlias).toBe('R-shared-lunch');
    expect(request.recipes).toEqual(preview.recipes);
  });

  it('rejects serving counts outside the supported integer range and restores the last valid value', () => {
    service.createProposal.and.returnValue(of(proposal()));
    component.generateProposal();
    fixture.detectChanges();

    const servingsInput = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-servings-shared-lunch"]'
    ) as HTMLInputElement;
    const ingredient = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-ingredient-shared-lunch-0"]'
    ) as HTMLElement;

    for (const invalidValue of ['0', '101', '1.5', '']) {
      servingsInput.value = invalidValue;
      servingsInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(servingsInput.value).toBe('2');
      expect(ingredient.textContent).toContain('100 g');
    }
    expect(service.createProposal).toHaveBeenCalledTimes(1);
  });

  it('scales quantities at both valid serving boundaries', () => {
    service.createProposal.and.returnValue(of(proposal()));
    component.generateProposal();
    fixture.detectChanges();

    const servingsInput = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-servings-shared-lunch"]'
    ) as HTMLInputElement;
    const ingredient = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-ingredient-shared-lunch-0"]'
    ) as HTMLElement;

    servingsInput.value = '1';
    servingsInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(ingredient.textContent).toContain('50 g');

    servingsInput.value = '100';
    servingsInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(ingredient.textContent?.replace(/[\s,]/g, '')).toContain('5000g');
    expect(service.createProposal).toHaveBeenCalledTimes(1);
  });

  it('separates preparation and review into exclusive linked panels', () => {
    service.createProposal.and.returnValue(of(proposal()));

    const tabs = fixture.nativeElement.querySelectorAll('[data-test^="meal-proposal-step-tab-"]');
    expect(tabs.length).toBe(3);
    for (const tab of Array.from(tabs) as HTMLButtonElement[]) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${panelId}`)).not.toBeNull();
    }
    const preparePanel = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-panel-prepare"]'
    ) as HTMLElement;
    const reviewPanel = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-panel-review"]'
    ) as HTMLElement;
    expect(preparePanel?.hidden).toBeFalse();
    expect(reviewPanel?.hidden).toBeTrue();
    const reviewTab = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-tab-review"]'
    ) as HTMLButtonElement;
    const prepareTab = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-tab-prepare"]'
    ) as HTMLButtonElement;

    component.generateProposal();
    fixture.detectChanges();

    expect(reviewTab.getAttribute('aria-selected')).toBe('true');
    expect(preparePanel.hidden).toBeTrue();
    expect(reviewPanel.hidden).toBeFalse();

    prepareTab.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="meal-proposal-review"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-proposal-step-panel-prepare"]').hidden
    ).toBeFalse();
  });

  it('confirms only after an explicit action and submits the validated preview unchanged', () => {
    const preview = proposal();
    service.createProposal.and.returnValue(of(preview));
    const confirmation: HouseholdMealProposalConfirmation = {
      proposalId: preview.proposalId,
      weekStart: preview.weekStart,
      idempotent: false,
      events: [],
      unresolvedEvents: []
    };
    service.confirmProposal.and.returnValue(of(confirmation));
    component.generateProposal();
    fixture.detectChanges();

    expect(service.confirmProposal).not.toHaveBeenCalled();
    component.confirmProposal();
    fixture.detectChanges();

    expect(service.confirmProposal).toHaveBeenCalledOnceWith('home-1', {
      proposalId: preview.proposalId,
      weekStart: preview.weekStart,
      householdMemberIds: ['member-1', 'member-2'],
      recipes: preview.recipes,
      events: preview.events
    });
    expect(component.confirmed()).toBeTrue();
    expect(component.canConfirm()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('household.meal_proposal_saved');
  });

  it('opens a separate read-only shopping review with required items selected and optionals excluded', () => {
    const preview: HouseholdMealShoppingPreview = {
      ...currentShoppingPreview(),
      previewId: 'a'.repeat(64),
      sharedPantry: true,
      plannedMealCount: 3,
      requiredIngredients: [
        {
          name: 'Arroz',
          unit: 'g',
          quantity: 200,
          stockQuantity: 50,
          missingQuantity: 150,
          status: 'matched'
        },
        {
          name: 'Harina',
          unit: 'g',
          quantity: 40,
          stockQuantity: null,
          missingQuantity: null,
          status: 'ambiguous'
        },
        {
          name: 'Tomate',
          unit: 'ud',
          quantity: 2,
          stockQuantity: 0,
          missingQuantity: 2,
          status: 'not_found'
        }
      ],
      optionalIngredients: [
        {
          name: 'Aceite',
          unit: 'ml',
          quantity: 15,
          stockQuantity: null,
          missingQuantity: null,
          status: 'unit_mismatch'
        }
      ],
      warnings: [{ code: 'RECIPE_SNAPSHOT_UNAVAILABLE', date: '2026-10-18' }]
    };
    shoppingService.loadPreview.and.returnValue(of(preview));

    const beforeWriteCount = shoppingService.approve.calls.count();
    component.openShoppingReview();
    fixture.detectChanges();

    expect(shoppingService.loadPreview).toHaveBeenCalledOnceWith(
      'home-1',
      jasmine.any(String),
      jasmine.any(String)
    );
    expect(shoppingService.approve.calls.count()).toBe(beforeWriteCount);
    expect(component.activeMealStep()).toBe('shopping');
    expect(component.shoppingLines().map((line) => [line.name, line.included])).toEqual([
      ['Arroz', true],
      ['Harina', false],
      ['Tomate', true],
      ['Aceite', false]
    ]);
    expect(fixture.nativeElement.textContent).toContain('household.meal_shopping_ambiguous');
    expect(fixture.nativeElement.textContent).toContain('household.meal_shopping_unit_mismatch');
    expect(fixture.nativeElement.textContent).toContain('household.meal_shopping_snapshot_warning');

    const tabs = fixture.nativeElement.querySelectorAll('[data-test^="meal-proposal-step-tab-"]');
    expect(tabs.length).toBe(3);
    for (const tab of Array.from(tabs) as HTMLButtonElement[]) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${panelId}`)).not.toBeNull();
    }
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-proposal-step-panel-review"]').hidden
    ).toBeTrue();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-shopping-step-panel"]').hidden
    ).toBeFalse();
  });

  it('approves only the checked editable quantities after an explicit confirmation action', () => {
    const preview: HouseholdMealShoppingPreview = {
      ...currentShoppingPreview(),
      previewId: 'c'.repeat(64),
      sharedPantry: true,
      plannedMealCount: 1,
      requiredIngredients: [
        {
          name: 'Arroz',
          unit: 'g',
          quantity: 200,
          stockQuantity: 50,
          missingQuantity: 150,
          status: 'matched'
        }
      ],
      optionalIngredients: [
        {
          name: 'Orégano',
          unit: 'g',
          quantity: 4,
          stockQuantity: 0,
          missingQuantity: 4,
          status: 'not_found'
        }
      ],
      warnings: []
    };
    const approval: HouseholdMealShoppingApproval = {
      listId: 'list-synthetic',
      version: 1,
      created: true,
      idempotent: false,
      added: 1,
      updated: 0,
      removed: 0
    };
    shoppingService.loadPreview.and.returnValue(of(preview));
    shoppingService.approve.and.returnValue(of(approval));
    component.openShoppingReview();
    fixture.detectChanges();
    component.setShoppingQuantity('arroz', 175);
    fixture.detectChanges();

    expect(shoppingService.approve).not.toHaveBeenCalled();
    component.approveShopping();
    fixture.detectChanges();

    expect(shoppingService.approve).toHaveBeenCalledOnceWith('home-1', {
      startDate: preview.startDate,
      endDate: preview.endDate,
      previewId: preview.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 175 }]
    });
    expect(component.shoppingApproval()).toEqual(approval);
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-shopping-compra-link"]')
    ).not.toBeNull();
  });

  it('leaves the preview without writing and rejects invalid edited quantities locally', () => {
    const preview: HouseholdMealShoppingPreview = {
      ...currentShoppingPreview(),
      previewId: 'd'.repeat(64),
      sharedPantry: false,
      plannedMealCount: 1,
      requiredIngredients: [
        {
          name: 'Arroz',
          unit: 'g',
          quantity: 200,
          stockQuantity: null,
          missingQuantity: null,
          status: 'pantry_not_shared'
        }
      ],
      optionalIngredients: [],
      warnings: []
    };
    shoppingService.loadPreview.and.returnValue(of(preview));
    component.openShoppingReview();
    fixture.detectChanges();
    expect(component.canApproveShopping()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('household.meal_shopping_pantry_private');

    component.setShoppingQuantity('arroz', 0);
    fixture.detectChanges();
    expect(component.canApproveShopping()).toBeFalse();
    component.setShoppingQuantity('arroz', 200);
    component.cancelShoppingReview();
    fixture.detectChanges();

    expect(shoppingService.approve).not.toHaveBeenCalled();
    expect(component.activeMealStep()).toBe('prepare');
  });

  it('invalidates a preview when week or participant selection changes', () => {
    service.createProposal.and.returnValue(of(proposal()));
    component.generateProposal();
    fixture.detectChanges();
    expect(component.canConfirm()).toBeTrue();

    component.toggleMember('member-2', false);
    fixture.detectChanges();
    expect(component.canConfirm()).toBeFalse();
    component.selectMealStep('review');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="meal-proposal-stale"]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-proposal-confirm"] button').disabled
    ).toBeTrue();
  });

  it('keeps errors recoverable and maps provider timeout without discarding the selection', () => {
    service.createProposal.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 504,
            error: { code: 'AI_PROVIDER_TIMEOUT' }
          })
      )
    );
    component.generateProposal();
    fixture.detectChanges();

    expect(component.selectedMemberIds()).toEqual(['member-1', 'member-2']);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.meal_proposal_ai_timeout'
    );
    expect(component.canGenerate()).toBeTrue();
  });

  it('explains where to complete enabled personal overrides before generating again', () => {
    service.createProposal.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: 'MEAL_PLAN_OVERRIDE_INCOMPLETE',
              missingFields: ['objective', 'schedule']
            }
          })
      )
    );
    component.generateProposal();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.meal_proposal_override_objective_and_schedule'
    );
    expect(component.canGenerate()).toBeTrue();
  });

  it('does not offer calendar confirmation when every proposal event needs review', () => {
    const reviewOnly = proposal();
    reviewOnly.events = reviewOnly.events.map((item) => ({
      ...item,
      recipeAlias: null,
      servings: 0,
      status: 'unresolved',
      reason: 'Revisión sintética requerida.'
    }));
    service.createProposal.and.returnValue(of(reviewOnly));

    component.generateProposal();
    fixture.detectChanges();

    expect(component.hasConfirmableMeals()).toBeFalse();
    expect(component.canConfirm()).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-proposal-no-confirmable-meals"]')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-proposal-confirm"] button').disabled
    ).toBeTrue();
  });

  it('cancels a pending request and clears the preview when the household context changes', () => {
    const pending = new Subject<HouseholdMealProposal>();
    service.createProposal.and.returnValue(pending);
    component.generateProposal();

    fixture.componentRef.setInput('householdId', 'home-2');
    fixture.componentRef.setInput('members', [member('member-3', 'user-3', 'Carmen')]);
    fixture.detectChanges();
    pending.next(proposal());
    fixture.detectChanges();

    expect(component.proposal()).toBeNull();
    expect(component.selectedMemberIds()).toEqual(['member-3']);
    expect(component.errorKey()).toBe('household.meal_proposal_context_changed');
  });

  it('maps generation errors to recoverable messages, including each incomplete override case', () => {
    const cases: Array<[string, Record<string, unknown>, TranslationKey]> = [
      ['HOUSEHOLD_CONTEXT_CHANGED', {}, 'household.meal_proposal_context_changed'],
      ['HOUSEHOLD_CALENDAR_EDIT_REQUIRED', {}, 'household.meal_proposal_edit_permission'],
      ['HOUSEHOLD_CALENDAR_VIEW_REQUIRED', {}, 'household.meal_proposal_view_permission'],
      ['AI_PROVIDER_NOT_CONFIGURED', {}, 'household.meal_proposal_ai_unconfigured'],
      ['AI_PROVIDER_ERROR', {}, 'household.meal_proposal_ai_error'],
      ['MEAL_PROPOSAL_GENERATION_FAILED', {}, 'household.meal_proposal_ai_error'],
      ['MEAL_PLAN_NO_SELECTED_TURNS', {}, 'household.meal_proposal_no_turns'],
      ['MEAL_PLAN_NO_SAFE_MEALS', {}, 'household.meal_proposal_no_safe_meals'],
      ['MEAL_PROPOSAL_SLOT_COVERAGE_INVALID', {}, 'household.meal_proposal_invalid_response'],
      ['MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID', {}, 'household.meal_proposal_invalid_response'],
      ['INVALID_MEAL_PROPOSAL_CONFIRMATION', {}, 'household.meal_proposal_invalid_response'],
      ['MEAL_PROPOSAL_CONFIRMATION_TOO_LARGE', {}, 'household.meal_proposal_invalid_response'],
      [
        'MEAL_PLAN_OVERRIDE_INCOMPLETE',
        { missingFields: ['objective'] },
        'household.meal_proposal_override_objective'
      ],
      [
        'MEAL_PLAN_OVERRIDE_INCOMPLETE',
        { missingFields: ['schedule'] },
        'household.meal_proposal_override_schedule'
      ],
      [
        'MEAL_PLAN_OVERRIDE_INCOMPLETE',
        { missingFields: 'invalid' },
        'household.meal_proposal_override_incomplete'
      ],
      ['UNKNOWN_CODE', {}, 'household.meal_proposal_generate_error']
    ];

    for (const [code, detail, expected] of cases) {
      service.createProposal.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { code, ...detail } }))
      );
      component.generateProposal();
      expect(component.errorKey()).withContext(code).toBe(expected);
    }

    service.createProposal.and.returnValue(throwError(() => new Error('network unavailable')));
    component.generateProposal();
    expect(component.errorKey()).toBe('household.meal_proposal_generate_error');
  });

  it('maps confirmation failures and reports a saved proposal with unresolved meals', () => {
    const preview = proposal();
    service.createProposal.and.returnValue(of(preview));
    component.generateProposal();

    service.confirmProposal.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'INVALID_MEAL_PROPOSAL_CONFIRMATION' }
          })
      )
    );
    component.confirmProposal();
    expect(component.errorKey()).toBe('household.meal_proposal_invalid_response');
    expect(component.confirming()).toBeFalse();

    service.confirmProposal.and.returnValue(throwError(() => new Error('network unavailable')));
    component.confirmProposal();
    expect(component.errorKey()).toBe('household.meal_proposal_confirm_error');

    service.confirmProposal.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'MEAL_PROPOSAL_RECIPE_CHANGED' }
          })
      )
    );
    component.confirmProposal();
    expect(component.errorKey()).toBe('household.meal_proposal_recipe_changed');

    service.confirmProposal.and.returnValue(
      of({
        proposalId: preview.proposalId,
        weekStart: preview.weekStart,
        idempotent: false,
        events: [],
        unresolvedEvents: [preview.events[0]]
      })
    );
    component.confirmProposal();
    expect(component.confirmed()).toBeTrue();
    expect(component.unresolvedEventsCount()).toBe(1);
    expect(component.successKey()).toBe('household.meal_proposal_saved_with_unresolved');
  });

  it('maps shopping preview and approval errors without treating an invalid preview as writable', () => {
    const cases: Array<[string, TranslationKey]> = [
      ['HOUSEHOLD_CONTEXT_CHANGED', 'household.meal_proposal_context_changed'],
      ['HOUSEHOLD_CALENDAR_VIEW_REQUIRED', 'household.meal_shopping_view_permission'],
      ['MEAL_SHOPPING_PREVIEW_STALE', 'household.meal_shopping_stale'],
      ['INVALID_MEAL_SHOPPING_APPROVAL', 'household.meal_shopping_invalid_preview'],
      ['MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW', 'household.meal_shopping_invalid_preview'],
      ['UNKNOWN_CODE', 'household.meal_shopping_error']
    ];

    for (const [code, expected] of cases) {
      shoppingService.loadPreview.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { code } }))
      );
      component.openShoppingReview();
      expect(component.shoppingErrorKey()).withContext(code).toBe(expected);
      expect(component.shoppingLoading()).toBeFalse();
    }

    shoppingService.loadPreview.and.returnValue(
      of({ ...currentShoppingPreview(), previewId: 'not-a-hash' })
    );
    component.openShoppingReview();
    expect(component.shoppingErrorKey()).toBe('household.meal_shopping_invalid_preview');
    expect(component.shoppingPreview()).toBeNull();
    expect(component.canApproveShopping()).toBeFalse();
  });

  it('keeps shopping read-only when access is unavailable, the selection is empty, or quantities are invalid', () => {
    shoppingService.loadPreview.and.returnValue(of(currentShoppingPreview()));
    fixture.componentRef.setInput('canViewShopping', false);
    fixture.detectChanges();
    component.openShoppingReview();
    expect(shoppingService.loadPreview).not.toHaveBeenCalled();

    fixture.componentRef.setInput('canViewShopping', true);
    fixture.detectChanges();
    component.openShoppingReview();
    expect(component.canApproveShopping()).toBeFalse();
    expect(shoppingService.approve).not.toHaveBeenCalled();

    component.shoppingLines.set([
      {
        name: 'Arroz',
        unit: 'g',
        quantity: 1,
        stockQuantity: 0,
        missingQuantity: 1,
        status: 'matched',
        key: '["ARROZ","g"]',
        optional: false,
        included: true,
        addQuantity: 10_001
      }
    ]);
    expect(component.canApproveShopping()).toBeFalse();

    component.shoppingLines.update((lines) => lines.map((line) => ({ ...line, addQuantity: 1 })));
    expect(component.canApproveShopping()).toBeTrue();
    component.shoppingSaving.set(true);
    expect(component.canApproveShopping()).toBeFalse();
    component.shoppingSaving.set(false);
    component.shoppingApproval.set({
      listId: 'list-1',
      version: 1,
      created: true,
      idempotent: false,
      added: 1,
      updated: 0,
      removed: 0
    });
    expect(component.canApproveShopping()).toBeFalse();
  });

  it('supports keyboard navigation across meal steps and ignores unrelated keys and dates', () => {
    shoppingService.loadPreview.and.returnValue(of(currentShoppingPreview()));
    const prepareTab = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-tab-prepare"]'
    ) as HTMLButtonElement;
    const reviewTab = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-tab-review"]'
    ) as HTMLButtonElement;
    const shoppingTab = fixture.nativeElement.querySelector(
      '[data-test="meal-proposal-step-tab-shopping"]'
    ) as HTMLButtonElement;

    prepareTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(component.activeMealStep()).toBe('review');
    expect(document.activeElement).toBe(reviewTab);

    reviewTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(component.activeMealStep()).toBe('shopping');
    expect(document.activeElement).toBe(shoppingTab);
    expect(component.shoppingPreview()).not.toBeNull();

    shoppingTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(component.activeMealStep()).toBe('review');
    reviewTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(component.activeMealStep()).toBe('prepare');

    const beforeUnknownKey = component.activeMealStep();
    prepareTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.activeMealStep()).toBe(beforeUnknownKey);

    component.selectMealStep('shopping');
    expect(component.activeMealStep()).toBe('shopping');
    component.selectMealStep('review');
    expect(component.activeMealStep()).toBe('review');
  });

  it('updates and rejects proposal day selection only for days in the proposal', () => {
    service.createProposal.and.returnValue(of(proposal()));
    component.generateProposal();
    component.selectProposalDate('2026-10-12');
    expect(component.selectedProposalDate()).toBe('2026-10-12');
    component.selectProposalDate('2026-10-19');
    expect(component.selectedProposalDate()).toBe('2026-10-12');
    expect(component.memberName('user-1')).toBe('Alicia');
    expect(component.memberName('unknown-user')).toBe('');
  });
});
