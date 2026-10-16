import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AiActionAssistantService } from '../../core/services/ai-action-assistant.service';
import { AiActionAssistantExecutionService } from '../../core/services/ai-action-assistant-execution.service';
import { HouseholdService } from '../../core/services/household.service';
import { HouseholdMealProposalService } from '../../core/services/household-meal-proposal.service';
import type { HouseholdMealProposal } from '../../core/services/household-meal-proposal.service';
import { I18nService } from '../../core/services/i18n.service';
import type {
  AssistantAction,
  AssistantActionCandidate,
  AssistantActionPlan
} from '../models/ai-action-assistant.model';
import type { AIRecipeResponse } from '../models/ai-config.model';
import type { Household } from '../models/household.model';
import { AiActionAssistantDialogComponent } from './ai-action-assistant-dialog.component';

describe('AiActionAssistantDialogComponent', () => {
  let fixture: ComponentFixture<AiActionAssistantDialogComponent>;
  let component: AiActionAssistantDialogComponent;
  let assistant: jasmine.SpyObj<AiActionAssistantService>;
  let execution: jasmine.SpyObj<AiActionAssistantExecutionService>;
  let mealProposals: jasmine.SpyObj<HouseholdMealProposalService>;
  let householdContext: {
    activeHouseholdId: ReturnType<typeof signal<string | null>>;
    household: ReturnType<typeof signal<Household | null>>;
  };
  let bodyOverflowBeforeFixture = '';
  let speechRecognitionDescriptor: PropertyDescriptor | undefined;
  let webkitSpeechRecognitionDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    bodyOverflowBeforeFixture = document.body.style.overflow;
    speechRecognitionDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechRecognition');
    webkitSpeechRecognitionDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'webkitSpeechRecognition'
    );
    assistant = jasmine.createSpyObj<AiActionAssistantService>('AiActionAssistantService', [
      'propose',
      'refine',
      'refineBatch'
    ]);
    execution = jasmine.createSpyObj<AiActionAssistantExecutionService>(
      'AiActionAssistantExecutionService',
      ['execute']
    );
    execution.execute.and.resolveTo(undefined);
    mealProposals = jasmine.createSpyObj<HouseholdMealProposalService>(
      'HouseholdMealProposalService',
      ['createAssistantProposal', 'refineAssistantProposal']
    );
    mealProposals.createAssistantProposal.and.returnValue(of(emptyMealProposal()));
    mealProposals.refineAssistantProposal.and.returnValue(of(emptyMealProposal()));
    householdContext = {
      activeHouseholdId: signal<string | null>(null),
      household: signal<Household | null>(null)
    };

    await TestBed.configureTestingModule({
      imports: [AiActionAssistantDialogComponent],
      providers: [
        provideHttpClient(),
        { provide: AiActionAssistantService, useValue: assistant },
        { provide: AiActionAssistantExecutionService, useValue: execution },
        { provide: HouseholdMealProposalService, useValue: mealProposals },
        { provide: HouseholdService, useValue: householdContext }
      ]
    }).compileComponents();

    TestBed.inject(I18nService).setLang('es');
    fixture = TestBed.createComponent(AiActionAssistantDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.body.style.overflow = bodyOverflowBeforeFixture;
    restoreWindowProperty('SpeechRecognition', speechRecognitionDescriptor);
    restoreWindowProperty('webkitSpeechRecognition', webkitSpeechRecognitionDescriptor);
  });

  it('keeps interpretation and review read-only until the final explicit confirmation', async () => {
    const plan = pantryPlan();
    assistant.propose.and.returnValue(of(plan));
    const prompt = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-prompt"]'
    ) as HTMLTextAreaElement;
    prompt.value = 'Añade lentejas';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-submit"]');
    fixture.detectChanges();

    expect(component.stage()).toBe('review');
    expect(execution.execute).not.toHaveBeenCalled();

    const action = plan.actions[0];
    component.updateField(action.id, ['quantity'], '750', 'number');
    component.setSelected(action.id, true);
    fixture.detectChanges();
    click('[data-test="ai-assistant-continue"]');
    fixture.detectChanges();

    expect(component.stage()).toBe('confirm');
    expect(execution.execute).not.toHaveBeenCalled();
    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm-fields"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Cantidad');
    expect(confirmation.textContent).toContain('750');

    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(execution.execute).toHaveBeenCalledTimes(1);
    const executedAction = execution.execute.calls.mostRecent().args[0] as AssistantAction;
    expect(executedAction.payload).toEqual(jasmine.objectContaining({ quantity: 750 }));
    expect(component.plan()?.actions[0].status).toBe('succeeded');
  });

  it('requires explicit meal participants, keeps drafts read-only through refinement, and confirms once', async () => {
    householdContext.activeHouseholdId.set('home-meals');
    householdContext.household.set({
      id: 'home-meals',
      name: 'Casa sintética',
      members: [
        {
          id: 'membership-1',
          userId: 'user-1',
          name: 'Persona de prueba',
          email: 'synthetic@example.test',
          role: 'member',
          cookingLevel: 'beginner',
          isActive: true,
          joinedAt: new Date(0),
          permissions: {
            pantry: { view: true, edit: true, manage: false },
            recipes: { view: true, create: true, edit: true, delete: false, generateAI: true },
            calendar: { view: true, edit: true },
            members: { invite: false, kick: false, manageRoles: false },
            settings: false
          }
        }
      ],
      inviteCode: '',
      sharedPantry: true,
      shareRecipes: true,
      shareCalendar: true,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    } as Household);
    const action = mealPlanAction();
    const generated = householdMealProposal('proposal-generated', 2);
    const refined = householdMealProposal('proposal-refined', 1);
    const plan: AssistantActionPlan = {
      id: 'meal-plan-1',
      summary: 'Propone comidas para una semana.',
      actions: [action],
      questions: []
    };
    assistant.propose.and.returnValue(of(plan));
    mealProposals.createAssistantProposal.and.returnValue(of(generated));
    mealProposals.refineAssistantProposal.and.returnValue(of(refined));
    enterPrompt('Planifica comidas para la semana del lunes.');
    fixture.detectChanges();
    click('[data-test="ai-assistant-submit"]');
    fixture.detectChanges();

    const participantCheckbox = fixture.nativeElement.querySelector(
      '.assistant__meal-participants input'
    ) as HTMLInputElement;
    expect(participantCheckbox.checked).toBeFalse();
    expect(component.canGenerateMealProposal(action)).toBeFalse();
    expect(execution.execute).not.toHaveBeenCalled();

    participantCheckbox.checked = true;
    participantCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-generate"]');
    fixture.detectChanges();
    expect(mealProposals.createAssistantProposal).toHaveBeenCalledWith('home-meals', {
      weekStart: '2026-10-19',
      householdMemberIds: ['membership-1'],
      instructions: 'Cenas sencillas.'
    });
    expect(execution.execute).not.toHaveBeenCalled();

    const servings = fixture.nativeElement.querySelector(
      '.assistant__meal-servings input'
    ) as HTMLInputElement;
    servings.value = '3';
    servings.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(component.mealProposalFor(action.id)?.events[0].servings).toBe(3);

    const refinement = fixture.nativeElement.querySelector(
      '.assistant__meal-refinement textarea'
    ) as HTMLTextAreaElement;
    refinement.value = 'Cambia la receta del lunes por pasta.';
    refinement.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-refine"]');
    fixture.detectChanges();
    expect(mealProposals.refineAssistantProposal).toHaveBeenCalledWith(
      'home-meals',
      jasmine.objectContaining({
        instructions: 'Cambia la receta del lunes por pasta.',
        events: [jasmine.objectContaining({ servings: 3 })]
      })
    );
    expect(component.mealProposalFor(action.id)?.events[0].servings).toBe(3);
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    expect(component.canContinue()).toBeTrue();
    component.goToConfirmation();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('3 Raciones');
    expect(execution.execute).not.toHaveBeenCalled();

    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(execution.execute).toHaveBeenCalledTimes(1);
    expect(execution.execute.calls.mostRecent().args[2]?.events[0].servings).toBe(3);
  });

  it('shows the existing task preimage in both review and final confirmation', () => {
    const action: AssistantAction = {
      id: 'task-update-1',
      kind: 'household.update_task',
      domain: 'household',
      actionType: 'update_task',
      title: 'Cambiar tarea existente',
      summary: 'Cambia el título de una tarea.',
      payload: {
        targetTitle: 'Revisar despensa',
        targetScheduledDate: '2026-10-20',
        changes: {
          title: 'Revisar alacena',
          details: null,
          scheduledDate: null,
          spaceName: null,
          assignedMemberName: null
        }
      },
      executionTarget: {
        kind: 'household-task',
        id: 'task-db-1',
        weekStart: '2026-10-19',
        version: 4,
        snapshot: {
          id: 'task-db-1',
          title: 'Revisar despensa',
          details: 'Reponer garbanzos',
          spaceId: null,
          scheduledDate: '2026-10-20',
          assignedMemberId: null,
          completed: false
        }
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    const plan: AssistantActionPlan = {
      id: 'task-update-plan',
      summary: 'Edita una tarea.',
      actions: [action],
      questions: []
    };
    component.plan.set(plan);
    component.stage.set('review');
    fixture.detectChanges();

    const review = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-task-target"]'
    ) as HTMLElement;
    expect(review.textContent).toContain('Revisar despensa');
    expect(review.textContent).toContain('2026-10-20');
    expect(review.textContent).toContain('Reponer garbanzos');
    expect(component.isActionValid(action)).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();

    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Tarea existente: «Revisar despensa»');
    expect(confirmation.textContent).toContain('Reponer garbanzos');
    expect(confirmation.textContent).toContain('Revisar alacena');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('blocks selection when a required earlier action is unselected', () => {
    const plan = pantryPlan();
    const child: AssistantAction = {
      ...plan.actions[0],
      id: 'action-2',
      title: 'Añadir a compra',
      kind: 'shopping.create_list',
      domain: 'shopping',
      actionType: 'create_list',
      payload: { name: 'Compra', store: null },
      dependsOn: [plan.actions[0].id]
    };
    component.plan.set({ ...plan, actions: [plan.actions[0], child] });
    component.setSelected(child.id, true);

    expect(component.hasUnselectedDependency(child)).toBeTrue();
    expect(component.canContinue()).toBeFalse();
  });

  it('allows an uncertain action to be retried while leaving completed actions final', async () => {
    const plan = pantryPlan();
    const action = plan.actions[0];
    component.plan.set(plan);
    component.setSelected(action.id, true);
    component.stage.set('confirm');
    execution.execute.and.returnValues(
      Promise.reject(new Error('temporary transport failure')),
      Promise.resolve(undefined)
    );
    fixture.detectChanges();

    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.plan()?.actions[0].status).toBe('failed');
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-test="ai-assistant-confirm-submit"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeFalse();

    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(execution.execute).toHaveBeenCalledTimes(2);
    expect(component.plan()?.actions[0].status).toBe('succeeded');
    expect(component.canExecuteSelected()).toBeFalse();
  });

  it('blocks dependent writes after failure and retries the dependency first', async () => {
    const plan = pantryPlan();
    const prerequisite = { ...plan.actions[0], selected: true };
    const dependent: AssistantAction = {
      ...calendarAction(),
      id: 'calendar-dependent',
      selected: true,
      dependsOn: [prerequisite.id]
    };
    component.plan.set({ ...plan, actions: [prerequisite, dependent] });
    component.stage.set('confirm');
    execution.execute.and.returnValue(Promise.reject(new Error('temporary failure')));

    await component.executeSelected();

    expect(execution.execute).toHaveBeenCalledTimes(1);
    expect(component.plan()?.actions.map((action) => action.status)).toEqual(['failed', 'blocked']);
    expect(component.executionMessage()).toBe('ai_assistant.execution_partial');

    execution.execute.and.returnValues(Promise.resolve(), Promise.resolve());
    await component.executeSelected();

    expect(execution.execute).toHaveBeenCalledTimes(3);
    expect(execution.execute.calls.mostRecent().args[0].id).toBe(dependent.id);
    expect(component.plan()?.actions.map((action) => action.status)).toEqual([
      'succeeded',
      'succeeded'
    ]);
  });

  it('locks background scrolling while open and restores its prior style when closed', () => {
    expect(document.body.style.overflow).toBe('hidden');

    component.modalOpen.set(false);
    fixture.detectChanges();

    expect(document.body.style.overflow).toBe(bodyOverflowBeforeFixture);
  });

  it('starts browser recognition only after voice consent and keeps transcript editable', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);

    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-test="ai-assistant-voice-start"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue();
    component.startVoice();
    expect(recognitions.length).toBe(0);

    component.voiceConsent.set(true);
    fixture.detectChanges();
    click('[data-test="ai-assistant-voice-start"]');
    fixture.detectChanges();
    expect(recognitions.length).toBe(1);
    expect(recognitions[0].started).toBeTrue();
    expect(component.voiceState()).toBe('listening');

    recognitions[0].onresult?.({
      results: [{ 0: { transcript: 'Añade garbanzos' }, isFinal: false }]
    });
    fixture.detectChanges();
    expect(component.prompt()).toBe('Añade garbanzos');
    expect(assistant.propose).not.toHaveBeenCalled();

    const prompt = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-prompt"]'
    ) as HTMLTextAreaElement;
    prompt.value = 'Añade 500 g de garbanzos';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(component.prompt()).toBe('Añade 500 g de garbanzos');
  });

  it('aborts active speech recognition as soon as voice consent is revoked', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    fixture.detectChanges();
    expect(component.voiceState()).toBe('listening');

    const consent = fixture.nativeElement.querySelector(
      '.assistant__consent input'
    ) as HTMLInputElement;
    consent.checked = false;
    consent.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    expect(component.voiceConsent()).toBeFalse();
    expect(component.voiceState()).toBe('idle');
    expect(recognitions[0].aborted).toBeTrue();

    recognitions[0].onresult?.({
      results: [{ 0: { transcript: 'No debe entrar texto tras revocar' }, isFinal: true }]
    });
    expect(component.prompt()).toBe('');
  });

  it('gives the remove action a visible translated label', () => {
    const plan = pantryPlan();
    component.plan.set(plan);
    component.stage.set('review');
    fixture.detectChanges();

    const removeButton = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-remove"] button'
    ) as HTMLButtonElement;
    expect(removeButton.textContent).toContain('Quitar propuesta');
  });

  it('uses translated app-pickers for catalog-backed fields', () => {
    const event = calendarAction();
    component.plan.set({ id: 'event-plan', summary: '', actions: [event], questions: [] });
    component.stage.set('review');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(0);
    const pickerButton = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-actions"] app-picker button'
    ) as HTMLButtonElement;
    expect(pickerButton.getAttribute('aria-label')).toBe('Tipo: Cita');

    TestBed.inject(I18nService).setLang('en');
    fixture.detectChanges();
    expect(pickerButton.getAttribute('aria-label')).toBe('Type: Appointment');

    const difficulty = component
      .editableFields(recipeAction())
      .find((field) => field.path[1] === 'difficulty');
    expect(difficulty?.choices?.map((choice) => choice.label)).toEqual(['Easy', 'Medium', 'Hard']);

    const recipe = recipeAction();
    component.plan.set({ id: 'recipe-plan', summary: '', actions: [recipe], questions: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(0);
    const recipePickers = fixture.nativeElement.querySelectorAll(
      '[data-test="ai-assistant-actions"] app-picker'
    ) as NodeListOf<HTMLElement>;
    expect(recipePickers.length).toBe(2);
    expect(recipePickers[1].querySelector('button')?.getAttribute('aria-label')).toBe('Unit: unit');
  });

  it('moves focus to the heading after each assistant stage change', async () => {
    const plan = pantryPlan();
    assistant.propose.and.returnValue(of(plan));
    component.prompt.set('Añade lentejas');

    component.propose();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-review"] h2')
    );

    component.beginRefine(plan.actions[0].id);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-refine-stage"] h2')
    );

    component.cancelRefine();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-review"] h2')
    );

    component.setSelected(plan.actions[0].id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-confirm"] h2')
    );

    component.returnToReview();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-review"] h2')
    );

    component.returnToCompose();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-compose"] h2')
    );
  });

  it('submits an explicit field scope and keeps the refinement limited to that field', () => {
    const plan = pantryPlan();
    const action = plan.actions[0];
    if (action.kind !== 'pantry.add_ingredient') throw new Error('Expected pantry action');
    const replacement: AssistantActionCandidate = {
      kind: action.kind,
      title: action.title,
      summary: action.summary,
      payload: { ...action.payload, quantity: 750 },
      dependsOn: [],
      warnings: []
    };
    assistant.refine.and.returnValue(
      of({
        actionId: action.id,
        summary: 'Cantidad ajustada.',
        replacement,
        questions: []
      })
    );
    component.plan.set(plan);
    component.beginRefine(action.id);
    component.chooseRefinementScope(JSON.stringify(['quantity']));
    component.refinementPrompt.set('Cambia a 750 gramos');

    component.refineCurrentAction();
    fixture.detectChanges();

    expect(assistant.refine).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scope: { kind: 'field', path: ['quantity'] }
      })
    );
    expect(component.plan()?.actions[0].payload).toEqual(
      jasmine.objectContaining({ quantity: 750, notes: null, name: 'Lentejas' })
    );
    expect(component.stage()).toBe('review');
  });

  it('refines the whole batch while preserving manual fields and app-owned selection state', () => {
    const pantry = pantryPlan().actions[0];
    if (pantry.kind !== 'pantry.add_ingredient') throw new Error('Expected pantry action');
    const shopping: AssistantAction = {
      id: 'shopping-1',
      kind: 'shopping.create_list',
      domain: 'shopping',
      actionType: 'create_list',
      title: 'Crear compra',
      summary: 'Crea una lista.',
      payload: { name: 'Compra semanal', store: null },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    const calendar = calendarAction();
    if (calendar.kind !== 'calendar.create_event') throw new Error('Expected calendar action');
    const shoppingReplacement: AssistantActionCandidate = {
      kind: shopping.kind,
      title: shopping.title,
      summary: 'Crea una lista sencilla.',
      payload: { ...shopping.payload, name: 'Compra sencilla' },
      dependsOn: [],
      warnings: []
    };
    assistant.refineBatch.and.returnValue(
      of({
        summary: 'Lote simplificado.',
        replacements: [
          {
            actionId: pantry.id,
            replacement: {
              kind: pantry.kind,
              title: pantry.title,
              summary: 'Añade una cantidad ajustada.',
              payload: { ...pantry.payload, quantity: 750, notes: 'Texto sobreescrito por IA' },
              dependsOn: [],
              warnings: []
            }
          },
          { actionId: shopping.id, replacement: shoppingReplacement },
          {
            actionId: calendar.id,
            replacement: {
              kind: calendar.kind,
              title: calendar.title,
              summary: calendar.summary,
              payload: calendar.payload,
              dependsOn: [],
              warnings: []
            }
          }
        ],
        questions: []
      })
    );
    component.plan.set({
      id: 'mixed-plan',
      summary: 'Original',
      actions: [pantry, shopping, calendar],
      questions: []
    });
    component.updateField(pantry.id, ['notes'], 'Nota editada manualmente');
    component.setSelected(pantry.id, true);
    component.stage.set('review');
    fixture.detectChanges();

    click('[data-test="ai-assistant-refine-batch"]');
    fixture.detectChanges();
    expect(component.refinementBatchScope()).toEqual({ kind: 'batch' });
    expect(component.batchRefinementScopeLabel()).toContain('3 propuestas');
    component.refinementPrompt.set('Simplifica el lote completo');
    component.refineCurrentAction();
    fixture.detectChanges();

    expect(assistant.refineBatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ scope: { kind: 'batch' } })
    );
    const actions = component.plan()?.actions ?? [];
    expect(actions[0].payload).toEqual(
      jasmine.objectContaining({ quantity: 750, notes: 'Nota editada manualmente' })
    );
    expect(actions[0].selected).toBeTrue();
    expect(actions[1].payload).toEqual(jasmine.objectContaining({ name: 'Compra sencilla' }));
    expect(actions[2].payload).toEqual(calendar.payload);
    expect(actions[0].manualFields).toEqual([JSON.stringify(['notes'])]);
    expect(component.stage()).toBe('review');
  });

  it('refines only the requested domain group and leaves other actions unchanged', () => {
    const pantry = pantryPlan().actions[0];
    const shoppingOne: AssistantAction = {
      id: 'shopping-1',
      kind: 'shopping.create_list',
      domain: 'shopping',
      actionType: 'create_list',
      title: 'Crear compra',
      summary: 'Crea una lista.',
      payload: { name: 'Compra semanal', store: null },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    const shoppingTwo: AssistantAction = {
      ...shoppingOne,
      id: 'shopping-2',
      kind: 'shopping.add_item',
      actionType: 'add_item',
      title: 'Añadir arroz',
      summary: 'Añade arroz a la compra.',
      payload: {
        listName: 'Compra semanal',
        name: 'Arroz',
        quantity: 1,
        unit: 'kg',
        category: null
      }
    };
    assistant.refineBatch.and.returnValue(
      of({
        summary: 'Compra revisada.',
        replacements: [
          {
            actionId: shoppingOne.id,
            replacement: {
              kind: shoppingOne.kind,
              title: shoppingOne.title,
              summary: shoppingOne.summary,
              payload: { ...shoppingOne.payload, name: 'Compra ajustada' },
              dependsOn: [],
              warnings: []
            }
          },
          {
            actionId: shoppingTwo.id,
            replacement: {
              kind: shoppingTwo.kind,
              title: shoppingTwo.title,
              summary: shoppingTwo.summary,
              payload: { ...shoppingTwo.payload, quantity: 2 },
              dependsOn: [],
              warnings: []
            }
          }
        ],
        questions: []
      })
    );
    component.plan.set({
      id: 'group-plan',
      summary: 'Original',
      actions: [pantry, shoppingOne, shoppingTwo],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const groupButton = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-refine-group"] button'
    ) as HTMLButtonElement;
    expect(groupButton.textContent).toContain('Refinar grupo de Compra');
    groupButton.click();
    fixture.detectChanges();
    expect(component.refinementBatchScope()).toEqual({ kind: 'group', domain: 'shopping' });
    component.refinementPrompt.set('Reconsidera solo las compras');
    component.refineCurrentAction();
    fixture.detectChanges();

    expect(assistant.refineBatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scope: { kind: 'group', domain: 'shopping' },
        actions: jasmine.arrayContaining([
          jasmine.objectContaining({ actionId: 'shopping-1' }),
          jasmine.objectContaining({ actionId: 'shopping-2' })
        ])
      })
    );
    expect(component.plan()?.actions[0]).toEqual(pantry);
    expect(component.plan()?.actions[2].payload).toEqual(jasmine.objectContaining({ quantity: 2 }));
  });

  it('keeps completed actions outside batch and group refinement scopes', () => {
    const completed = { ...pantryPlan().actions[0], status: 'succeeded' as const };
    const shopping = {
      ...completed,
      id: 'shopping-1',
      kind: 'shopping.create_list' as const,
      domain: 'shopping' as const,
      actionType: 'create_list' as const,
      title: 'Crear compra',
      payload: { name: 'Compra semanal', store: null },
      status: 'pending' as const
    };
    const calendar = calendarAction();
    component.plan.set({
      id: 'partial-plan',
      summary: 'Plan parcial',
      actions: [completed, shopping, calendar],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const completedRefine = fixture.nativeElement.querySelector(
      `[data-action-id="${completed.id}"] [data-test="ai-assistant-refine"] button`
    ) as HTMLButtonElement;
    expect(completedRefine.disabled).toBeTrue();
    expect(component.refinableActions().map((action) => action.id)).toEqual([
      shopping.id,
      calendar.id
    ]);
    component.beginRefine(completed.id);
    expect(component.stage()).toBe('review');

    component.beginBatchRefine();
    expect(component.refiningActionIds()).toEqual([shopping.id, calendar.id]);
  });

  it('offers explicit recipe section and field scopes', () => {
    const options = component.refinementScopeOptions(recipeAction());

    expect(options.map((option) => option.value)).toContain(
      JSON.stringify(['recipe', 'ingredients'])
    );
    expect(options.map((option) => option.value)).toContain(
      JSON.stringify(['recipe', 'instructionsByLevel'])
    );
    expect(options.map((option) => option.label)).toContain('Sección: Ingredientes');
    expect(options.map((option) => option.label)).toContain('Campo: Dificultad');
  });

  it('exposes optional pause/resume and aborts recognition on cancel', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    component.pauseVoice();
    expect(component.voiceState()).toBe('paused');
    expect(recognitions[0].paused).toBeTrue();

    component.resumeVoice();
    expect(component.voiceState()).toBe('listening');
    expect(recognitions[0].resumed).toBeTrue();

    component.cancelVoice();
    expect(component.voiceState()).toBe('idle');
    expect(recognitions[0].aborted).toBeTrue();
  });

  it('reports denied microphone permission and falls back to text when unsupported', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    recognitions[0].onerror?.({ error: 'not-allowed' });
    fixture.detectChanges();
    expect(component.voiceState()).toBe('error');
    expect(component.voiceError()).toBe('ai_assistant.voice_permission');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    mountWithSpeech(null);
    expect(component.voiceSupported()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[data-test="ai-assistant-prompt"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'El reconocimiento de voz no está disponible'
    );
  });

  function click(selector: string): void {
    const button = fixture.nativeElement.querySelector(`${selector} button`) as HTMLButtonElement;
    expect(button).withContext(`Expected button for ${selector}`).not.toBeNull();
    button.click();
  }

  function enterPrompt(value: string): void {
    const prompt = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-prompt"]'
    ) as HTMLTextAreaElement;
    prompt.value = value;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function mountWithSpeech(
    constructor: typeof FakeSpeechRecognition | null
  ): FakeSpeechRecognition[] {
    fixture.destroy();
    FakeSpeechRecognition.instances = [];
    const speechWindow = window as unknown as Record<string, unknown>;
    Object.defineProperty(speechWindow, 'SpeechRecognition', {
      configurable: true,
      value: constructor ?? undefined
    });
    Object.defineProperty(speechWindow, 'webkitSpeechRecognition', {
      configurable: true,
      value: undefined
    });
    fixture = TestBed.createComponent(AiActionAssistantDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return FakeSpeechRecognition.instances;
  }

  function restoreWindowProperty(name: string, descriptor?: PropertyDescriptor): void {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else Reflect.deleteProperty(window, name);
  }
});

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  started = false;
  stopped = false;
  aborted = false;
  paused = false;
  resumed = false;
  onresult:
    | ((event: { results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void)
    | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  abort(): void {
    this.aborted = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.resumed = true;
  }
}

function pantryPlan(): AssistantActionPlan {
  const action: AssistantAction = {
    id: 'action-1',
    kind: 'pantry.add_ingredient',
    domain: 'pantry',
    actionType: 'add_ingredient',
    title: 'Añadir lentejas',
    summary: 'Añade 500 g de lentejas a la despensa.',
    payload: {
      name: 'Lentejas',
      category: 'legumes',
      quantity: 500,
      unit: 'g',
      expirationDate: null,
      location: 'pantry',
      notes: null
    },
    dependsOn: [],
    warnings: [],
    selected: false,
    status: 'pending'
  };
  return { id: 'plan-1', summary: 'Añadir lentejas', actions: [action], questions: [] };
}

function mealPlanAction(): AssistantAction {
  return {
    id: 'meal-action-1',
    kind: 'household.plan_meals',
    domain: 'household',
    actionType: 'plan_meals',
    title: 'Proponer comidas',
    summary: 'Prepara una propuesta de comidas revisable.',
    payload: { weekStart: '2026-10-19', instructions: 'Cenas sencillas.' },
    dependsOn: [],
    warnings: [],
    selected: false,
    status: 'pending'
  };
}

function emptyMealProposal(): HouseholdMealProposal {
  return {
    proposalId: 'empty-proposal',
    weekStart: '2026-10-19',
    participants: [],
    recipes: [],
    events: []
  };
}

function householdMealProposal(proposalId: string, servings: number): HouseholdMealProposal {
  return {
    proposalId,
    weekStart: '2026-10-19',
    participants: [{ alias: 'P1', householdMemberId: 'membership-1' }],
    recipes: [
      {
        alias: 'N1',
        source: 'new',
        recipeId: null,
        recipe: {
          name: 'Crema de verduras',
          description: 'Receta sintética para test.',
          ingredients: [{ name: 'Calabacín', quantity: 1, unit: 'ud' }]
        } as never
      }
    ],
    events: [
      {
        id: 'event-1',
        date: '2026-10-19',
        mealType: 'lunch',
        time: '13:00',
        recipeAlias: 'N1',
        participantAliases: ['P1'],
        participantIds: ['user-1'],
        servings,
        objectiveSummary: 'Comida equilibrada.',
        status: 'scheduled',
        reason: null
      }
    ]
  };
}

function calendarAction(): AssistantAction {
  return {
    id: 'calendar-action',
    kind: 'calendar.create_event',
    domain: 'calendar',
    actionType: 'create_event',
    title: 'Evento',
    summary: 'Crea un evento.',
    payload: {
      title: 'Cita médica',
      kind: 'appointment',
      date: '2026-10-16',
      startTime: null,
      endTime: null,
      allDay: false,
      sharedWithHousehold: false,
      location: null,
      notes: null
    },
    dependsOn: [],
    warnings: [],
    selected: false,
    status: 'pending'
  };
}

function recipeAction(): AssistantAction {
  const recipe: AIRecipeResponse = {
    name: 'Tortilla',
    description: 'Una tortilla sencilla.',
    difficulty: 'easy',
    cuisine: null,
    totalTime: 20,
    prepTime: 10,
    cookTime: 10,
    baseServings: 1,
    calories: null,
    ingredients: [
      {
        name: 'Huevos',
        quantity: 2,
        unit: 'unit',
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: [],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: { basic: [], intermediate: [], expert: [] },
    tags: [],
    nutrition: null,
    storage: null,
    restTime: null
  };
  return {
    id: 'recipe-action',
    kind: 'recipes.create_draft',
    domain: 'recipes',
    actionType: 'create_draft',
    title: 'Receta',
    summary: 'Crea una receta.',
    payload: { recipe },
    dependsOn: [],
    warnings: [],
    selected: false,
    status: 'pending'
  };
}
