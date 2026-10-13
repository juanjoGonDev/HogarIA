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
    recipe: {
      name: id === 'shared-lunch' ? 'Lentejas para compartir' : 'Tortilla individual',
      description: 'Receta sintética de prueba.',
      baseServings: 1,
      prepTimeMinutes: 10,
      cookTimeMinutes: 20,
      ingredients: [
        {
          name: 'Patata',
          quantity: 100,
          unit: 'g',
          preparation: null,
          isOptional: false,
          notes: null
        }
      ],
      instructions: ['Cocinar con el resto de ingredientes.']
    },
    participantAliases: aliases,
    participantIds,
    servings,
    objectiveSummary: aliases.length > 1 ? 'Plato compartido.' : 'Plato individual.',
    status: 'scheduled',
    reason: null
  };
}

function proposal(): HouseholdMealProposal {
  return {
    proposalId: 'proposal-synthetic',
    weekStart: '2026-10-12',
    participants: [
      { alias: 'P1', householdMemberId: 'member-1' },
      { alias: 'P2', householdMemberId: 'member-2' }
    ],
    events: [
      event('shared-lunch', 'lunch', ['P1', 'P2'], ['user-1', 'user-2'], 2),
      event('solo-dinner-one', 'dinner', ['P1'], ['user-1'], 1),
      event('solo-dinner-two', 'dinner', ['P2'], ['user-2'], 1)
    ]
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
      t: (key: string, params?: Record<string, unknown>) =>
        key === 'household.meal_proposal_servings' ? `${params?.['count']} raciones` : key
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
    expect(fixture.nativeElement.textContent).toContain('2 raciones');
    expect(fixture.nativeElement.textContent).toContain('Alicia');
    expect(fixture.nativeElement.textContent).toContain('Bruno');
    expect(component.canConfirm()).toBeTrue();
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
      events: preview.events
    });
    expect(component.confirmed()).toBeTrue();
    expect(component.canConfirm()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('household.meal_proposal_saved');
  });

  it('opens a separate read-only shopping review with required items selected and optionals excluded', () => {
    const preview: HouseholdMealShoppingPreview = {
      startDate: '2026-10-13',
      endDate: '2026-11-12',
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
      startDate: '2026-10-13',
      endDate: '2026-11-12',
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
      startDate: '2026-10-13',
      endDate: '2026-11-12',
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
      recipe: null,
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
});
