import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { HouseholdMealPlannerComponent } from './household-meal-planner.component';
import { HouseholdMealProposalService } from '../../core/services/household-meal-proposal.service';
import type {
  HouseholdMealProposal,
  HouseholdMealProposalConfirmation
} from '../../core/services/household-meal-proposal.service';
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

  beforeEach(async () => {
    service = jasmine.createSpyObj<HouseholdMealProposalService>('HouseholdMealProposalService', [
      'createProposal',
      'confirmProposal'
    ]);
    const i18n = {
      resolved: signal<'es' | 'en'>('es'),
      changeTick: signal(0),
      t: (key: string, params?: Record<string, unknown>) =>
        key === 'household.meal_proposal_servings' ? `${params?.['count']} raciones` : key
    } as unknown as I18nService;

    await TestBed.configureTestingModule({
      imports: [HouseholdMealPlannerComponent],
      providers: [
        { provide: HouseholdMealProposalService, useValue: service },
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

  it('invalidates a preview when week or participant selection changes', () => {
    service.createProposal.and.returnValue(of(proposal()));
    component.generateProposal();
    fixture.detectChanges();
    expect(component.canConfirm()).toBeTrue();

    component.toggleMember('member-2', false);
    fixture.detectChanges();
    expect(component.canConfirm()).toBeFalse();
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
