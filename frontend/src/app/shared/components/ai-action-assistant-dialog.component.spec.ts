import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { NEVER, Observable, of, Subject } from 'rxjs';
import { AiActionAssistantService } from '../../core/services/ai-action-assistant.service';
import { AiActionAssistantExecutionService } from '../../core/services/ai-action-assistant-execution.service';
import { HouseholdService } from '../../core/services/household.service';
import { HouseholdMealProposalService } from '../../core/services/household-meal-proposal.service';
import { HouseholdMealShoppingService } from '../../core/services/household-meal-shopping.service';
import type {
  HouseholdMealShoppingApproval,
  HouseholdMealShoppingPreview
} from '../../core/services/household-meal-shopping.service';
import { PantryService } from '../../core/services/pantry.service';
import type { HouseholdMealProposal } from '../../core/services/household-meal-proposal.service';
import { I18nService } from '../../core/services/i18n.service';
import type {
  AssistantCalendarEventUpdateExecutionTarget,
  AssistantAction,
  AssistantActionCandidate,
  AssistantActionPlan,
  CalendarEventUpdatePayload
} from '../models/ai-action-assistant.model';
import type { AIRecipeResponse } from '../models/ai-config.model';
import type { Household } from '../models/household.model';
import type { PantryCategory } from '../models/pantry.model';
import { AiActionAssistantDialogComponent } from './ai-action-assistant-dialog.component';

describe('AiActionAssistantDialogComponent', () => {
  let fixture: ComponentFixture<AiActionAssistantDialogComponent>;
  let component: AiActionAssistantDialogComponent;
  let assistant: jasmine.SpyObj<AiActionAssistantService>;
  let execution: jasmine.SpyObj<AiActionAssistantExecutionService>;
  let mealProposals: jasmine.SpyObj<HouseholdMealProposalService>;
  let mealShopping: jasmine.SpyObj<HouseholdMealShoppingService>;
  let pantryService: jasmine.SpyObj<PantryService>;
  let navigationEvents: Subject<NavigationEnd>;
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
      ['createAssistantProposal', 'refineAssistantProposal', 'previewAssistantShopping']
    );
    mealProposals.createAssistantProposal.and.returnValue(of(emptyMealProposal()));
    mealProposals.refineAssistantProposal.and.returnValue(of(emptyMealProposal()));
    mealProposals.previewAssistantShopping.and.returnValue(of(emptyMealShoppingPreview()));
    mealShopping = jasmine.createSpyObj<HouseholdMealShoppingService>(
      'HouseholdMealShoppingService',
      ['loadPreview', 'approve']
    );
    mealShopping.loadPreview.and.returnValue(of(emptyMealShoppingPreview()));
    mealShopping.approve.and.returnValue(of(emptyMealShoppingApproval()));
    navigationEvents = new Subject<NavigationEnd>();
    pantryService = jasmine.createSpyObj<PantryService>('PantryService', ['loadCategories'], {
      categories: signal<PantryCategory[]>([
        {
          id: 'category-dairy',
          key: 'dairy',
          name: 'Lácteos',
          color: '#abcdef',
          description: null,
          parentKey: null,
          parentName: null,
          position: 1,
          counts: { products: 0, children: 0, descendantProducts: 0 },
          protected: false,
          canDelete: true
        },
        {
          id: 'category-other',
          key: 'other',
          name: 'Otros',
          color: '#abcdef',
          description: null,
          parentKey: null,
          parentName: null,
          position: 2,
          counts: { products: 0, children: 0, descendantProducts: 0 },
          protected: true,
          canDelete: false
        }
      ])
    });
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
        { provide: HouseholdMealShoppingService, useValue: mealShopping },
        { provide: PantryService, useValue: pantryService },
        { provide: HouseholdService, useValue: householdContext },
        {
          provide: Router,
          useValue: { url: '/dashboard', events: navigationEvents.asObservable() }
        }
      ]
    }).compileComponents();

    const i18n = TestBed.inject(I18nService);
    i18n.setLang('es');
    await i18n.loadAssistantTranslations();
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

  it('does not send duplicate proposal requests while the first request is pending', () => {
    assistant.propose.and.returnValue(NEVER);
    component.prompt.set('Añade lentejas');

    component.propose();
    component.propose();

    expect(assistant.propose).toHaveBeenCalledTimes(1);
    expect(component.loading()).toBeTrue();
  });

  it('does not send duplicate refinement requests while the first request is pending', () => {
    const plan = pantryPlan();
    component.plan.set(plan);
    component.beginRefine(plan.actions[0].id);
    component.refinementPrompt.set('Cambia la cantidad a 750 g');
    assistant.refine.and.returnValue(NEVER);

    component.refineCurrentAction();
    component.refineCurrentAction();

    expect(assistant.refine).toHaveBeenCalledTimes(1);
    expect(component.loading()).toBeTrue();
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

  it('derives a separate shopping approval only from a confirmed meal plan and verifiable shortages', async () => {
    householdContext.activeHouseholdId.set('home-meals');
    householdContext.household.set(syntheticMealHousehold());
    const action = mealPlanAction();
    const weekStart = '2026-10-19';
    const plan: AssistantActionPlan = {
      id: 'meal-shopping-plan',
      summary: 'Planifica y revisa faltantes.',
      actions: [action],
      questions: []
    };
    assistant.propose.and.returnValue(of(plan));
    mealProposals.createAssistantProposal.and.returnValue(
      of(householdMealProposal('shopping-proposal', 2))
    );
    const preview: HouseholdMealShoppingPreview = {
      startDate: weekStart,
      endDate: '2026-10-25',
      previewId: 'a'.repeat(64),
      sharedPantry: true,
      plannedMealCount: 1,
      requiredIngredients: [
        {
          name: 'Arroz',
          unit: 'g',
          quantity: 100,
          stockQuantity: 25,
          missingQuantity: 75,
          status: 'matched'
        },
        {
          name: 'Sal',
          unit: 'g',
          quantity: 3,
          stockQuantity: 10,
          missingQuantity: 0,
          status: 'matched'
        },
        {
          name: 'Harina',
          unit: 'g',
          quantity: 20,
          stockQuantity: null,
          missingQuantity: null,
          status: 'ambiguous'
        }
      ],
      optionalIngredients: [
        {
          name: 'Aceite',
          unit: 'ml',
          quantity: 10,
          stockQuantity: 0,
          missingQuantity: 10,
          status: 'not_found'
        }
      ],
      warnings: []
    };
    mealShopping.loadPreview.and.returnValue(of(preview));
    const approval: HouseholdMealShoppingApproval = {
      listId: 'meal-plan-list',
      version: 1,
      created: true,
      idempotent: false,
      added: 2,
      updated: 0,
      removed: 0
    };
    mealShopping.approve.and.returnValue(of(approval));

    enterPrompt('Planifica comidas y dime qué falta para comprar.');
    fixture.detectChanges();
    click('[data-test="ai-assistant-submit"]');
    fixture.detectChanges();
    const participant = fixture.nativeElement.querySelector(
      '.assistant__meal-participants input'
    ) as HTMLInputElement;
    participant.checked = true;
    participant.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-generate"]');
    fixture.detectChanges();
    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();

    expect(mealShopping.loadPreview).not.toHaveBeenCalled();
    expect(mealShopping.approve).not.toHaveBeenCalled();
    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.plan()?.actions[0].status).toBe('succeeded');
    expect(component.confirmedMealPlanActions().map((item) => item.id)).toEqual([action.id]);
    expect(mealShopping.approve).not.toHaveBeenCalled();
    click('[data-test="ai-assistant-meals-shopping-open"]');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mealShopping.loadPreview).toHaveBeenCalledWith('home-meals', '2026-10-19', '2026-10-25');
    expect(mealShopping.approve).not.toHaveBeenCalled();

    const lines = Array.from(
      fixture.nativeElement.querySelectorAll('.assistant__shopping-line')
    ) as HTMLElement[];
    const rice = lines.find((line) => line.textContent?.includes('Arroz'))!;
    const salt = lines.find((line) => line.textContent?.includes('Sal'))!;
    const flour = lines.find((line) => line.textContent?.includes('Harina'))!;
    const oil = lines.find((line) => line.textContent?.includes('Aceite'))!;
    expect((rice.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBeTrue();
    expect((oil.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBeFalse();
    expect((salt.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBeTrue();
    expect((flour.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBeTrue();

    const oilCheckbox = oil.querySelector('input[type="checkbox"]') as HTMLInputElement;
    oilCheckbox.checked = true;
    oilCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(mealShopping.approve).not.toHaveBeenCalled();
    click('[data-test="ai-assistant-meals-shopping-approve"]');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mealShopping.approve).toHaveBeenCalledWith('home-meals', {
      startDate: '2026-10-19',
      endDate: '2026-10-25',
      previewId: 'a'.repeat(64),
      items: [
        { name: 'Arroz', unit: 'g', quantity: 75 },
        { name: 'Aceite', unit: 'ml', quantity: 10 }
      ]
    });
    expect(component.mealShoppingApproval(action.id)).toEqual(approval);
  });

  it('keeps meal-derived shopping out of an unconfirmed meal draft', () => {
    householdContext.activeHouseholdId.set('home-meals');
    householdContext.household.set(syntheticMealHousehold());
    const action = mealPlanAction();
    const proposal = householdMealProposal('shopping-draft', 2);
    const plan: AssistantActionPlan = {
      id: 'meal-shopping-draft-plan',
      summary: 'Planifica comidas y compra faltantes.',
      actions: [action],
      questions: []
    };
    assistant.propose.and.returnValue(of(plan));
    mealProposals.createAssistantProposal.and.returnValue(of(proposal));
    mealProposals.refineAssistantProposal.and.returnValue(
      of(householdMealProposal('shopping-refined', 2))
    );

    enterPrompt('Planifica comidas y añade los faltantes a la compra.');
    fixture.detectChanges();
    click('[data-test="ai-assistant-submit"]');
    fixture.detectChanges();
    const participant = fixture.nativeElement.querySelector(
      '.assistant__meal-participants input'
    ) as HTMLInputElement;
    participant.checked = true;
    participant.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-generate"]');
    fixture.detectChanges();

    expect(mealProposals.previewAssistantShopping).not.toHaveBeenCalled();
    expect(component.plan()!.actions).toEqual([action]);
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-meals-shopping-draft"]')
    ).toBeNull();

    const servings = fixture.nativeElement.querySelector(
      '.assistant__meal-servings input'
    ) as HTMLInputElement;
    servings.value = '3';
    servings.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    const refinement = fixture.nativeElement.querySelector(
      '.assistant__meal-refinement textarea'
    ) as HTMLTextAreaElement;
    refinement.value = 'Cambia la receta del lunes.';
    refinement.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-refine"]');
    fixture.detectChanges();

    expect(mealProposals.refineAssistantProposal).toHaveBeenCalled();
    expect(mealProposals.previewAssistantShopping).not.toHaveBeenCalled();
    expect(component.plan()!.actions).toEqual([action]);
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('cancels a post-confirmation shopping preview when the dialog is destroyed', async () => {
    householdContext.activeHouseholdId.set('home-meals');
    householdContext.household.set(syntheticMealHousehold());
    const action = mealPlanAction();
    assistant.propose.and.returnValue(
      of({
        id: 'meal-shopping-cancel-plan',
        summary: 'Planifica comidas.',
        actions: [action],
        questions: []
      })
    );
    mealProposals.createAssistantProposal.and.returnValue(
      of(householdMealProposal('shopping-cancel', 2))
    );
    let cancelled = false;
    mealShopping.loadPreview.and.returnValue(
      new Observable<HouseholdMealShoppingPreview>(() => () => {
        cancelled = true;
      })
    );

    enterPrompt('Planifica comidas.');
    fixture.detectChanges();
    click('[data-test="ai-assistant-submit"]');
    fixture.detectChanges();
    const participant = fixture.nativeElement.querySelector(
      '.assistant__meal-participants input'
    ) as HTMLInputElement;
    participant.checked = true;
    participant.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-generate"]');
    fixture.detectChanges();
    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();
    click('[data-test="ai-assistant-meals-shopping-open"]');

    expect(cancelled).toBeFalse();
    component.ngOnDestroy();
    expect(cancelled).toBeTrue();
    expect(execution.execute).toHaveBeenCalled();
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
          priority: null,
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
          priority: 'medium',
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
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-task-priority"]')?.textContent
    ).toContain('Media');
    expect(
      component.editableFields(action).some((field) => field.path.join('.') === 'changes.priority')
    ).toBeTrue();
    expect(component.isActionValid(action)).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();

    component.updateField(action.id, ['changes', 'priority'], 'high', 'select');
    fixture.detectChanges();
    const edited = component.plan()!.actions[0];
    if (edited.kind !== 'household.update_task') throw new Error('Expected task update action');
    expect(component.taskPriority(edited)).toBe('high');
    expect(component.isActionValid(edited)).toBeTrue();
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

  it('reviews and edits a new task priority before the explicit assistant confirmation', async () => {
    const action: AssistantAction = {
      id: 'task-create-priority-1',
      kind: 'household.create_task',
      domain: 'household',
      actionType: 'create_task',
      title: 'Crear tarea doméstica',
      summary: 'Crea una tarea con prioridad alta.',
      payload: {
        title: 'Limpiar cocina',
        details: null,
        scheduledDate: '2026-10-19',
        priority: 'medium',
        spaceName: null,
        assignedMemberName: null
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    const plan: AssistantActionPlan = {
      id: 'task-create-priority-plan',
      summary: 'Crea una tarea doméstica.',
      actions: [action],
      questions: []
    };
    component.plan.set(plan);
    component.stage.set('review');
    fixture.detectChanges();

    const priorityField = component
      .editableFields(action)
      .find((field) => field.path.join('.') === 'priority');
    expect(priorityField?.kind).toBe('select');
    expect(priorityField?.choices?.map((choice) => choice.value)).toEqual([
      'low',
      'medium',
      'high'
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-task-priority"]')?.textContent
    ).toContain('Media');
    for (const priority of ['low', 'medium', 'high']) {
      const candidate = {
        ...action,
        payload: { ...action.payload, priority }
      } as AssistantAction;
      expect(component.isActionValid(candidate)).toBeTrue();
    }

    component.updateField(action.id, ['priority'], 'high', 'select');
    fixture.detectChanges();
    const edited = component.plan()!.actions[0];
    if (edited.kind !== 'household.create_task') throw new Error('Expected task creation action');
    expect(edited.payload.priority).toBe('high');
    expect(component.taskPriority(edited)).toBe('high');
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-task-priority"]')?.textContent
    ).toContain('Alta');
    expect(
      component.isActionValid({
        ...edited,
        payload: { ...edited.payload, priority: 'urgent' }
      } as unknown as AssistantAction)
    ).toBeFalse();
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Alta');
    expect(execution.execute).not.toHaveBeenCalled();

    click('[data-test="ai-assistant-confirm-submit"]');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(execution.execute).toHaveBeenCalledTimes(1);
    expect(execution.execute.calls.mostRecent().args[0].payload).toEqual(
      jasmine.objectContaining({ priority: 'high' })
    );
  });

  it('shows and edits the resolved shopping list without writing before explicit approval', () => {
    const action: AssistantAction = {
      id: 'shopping-update-1',
      kind: 'shopping.update_list',
      domain: 'shopping',
      actionType: 'update_list',
      title: 'Cambiar lista de compra',
      summary: 'Renombra la lista y cambia la tienda.',
      payload: {
        targetName: 'Compra semanal',
        changes: { name: 'Compra del sábado', setName: true, store: 'Mercadona', setStore: true }
      },
      executionTarget: {
        kind: 'shopping-list',
        id: 'shopping-list-1',
        version: 3,
        snapshot: { name: 'Compra semanal', store: 'Lidl' }
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    component.plan.set({
      id: 'shopping-update-plan',
      summary: 'Actualiza una lista existente.',
      actions: [action],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-shopping-target"]'
    ) as HTMLElement;
    expect(target.textContent).toContain('Compra semanal');
    expect(target.textContent).toContain('Lidl');
    expect(component.isActionValid(action)).toBeTrue();

    const details = fixture.nativeElement.querySelector(
      `[data-test="ai-assistant-action-details-${action.id}"]`
    ) as HTMLDetailsElement;
    details.open = true;
    fixture.detectChanges();
    const fields = details.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;
    expect(fields.length).toBe(2);
    expect(fields[0].value).toBe('Compra del sábado');
    expect(fields[1].value).toBe('Mercadona');
    fields[0].value = 'Compra del jueves';
    fields[0].dispatchEvent(new Event('input', { bubbles: true }));
    fields[1].value = 'Alcampo';
    fields[1].dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(component.plan()?.actions[0].payload).toEqual(
      jasmine.objectContaining({
        targetName: 'Compra semanal',
        changes: { name: 'Compra del jueves', setName: true, store: 'Alcampo', setStore: true }
      })
    );

    fields[1].value = '   ';
    fields[1].dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(component.plan()?.actions[0].payload).toEqual(
      jasmine.objectContaining({
        targetName: 'Compra semanal',
        changes: { name: 'Compra del jueves', setName: true, store: null, setStore: true }
      })
    );
    expect(component.isActionValid(component.plan()!.actions[0])).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Compra semanal');
    expect(confirmation.textContent).toContain('Compra del jueves');
    expect(confirmation.textContent).toContain('—');
    expect(confirmation.textContent).not.toContain('Alcampo');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('reviews an exact shopping item and shows before/after values until explicit approval', () => {
    const action: AssistantAction = {
      id: 'shopping-item-update-1',
      kind: 'shopping.update_item',
      domain: 'shopping',
      actionType: 'update_item',
      title: 'Ajustar cantidad de leche',
      summary: 'Deja dos litros de leche en Compra semanal.',
      payload: {
        listName: 'Compra semanal',
        targetName: 'Leche',
        matchUnit: true,
        targetUnit: 'l',
        changes: {
          name: null,
          setName: false,
          quantity: 2,
          setQuantity: true,
          unit: null,
          setUnit: false,
          category: null,
          setCategory: false
        }
      },
      executionTarget: {
        kind: 'shopping-item',
        id: 'shopping-item-1',
        listId: 'shopping-list-1',
        version: 3,
        snapshot: {
          listName: 'Compra semanal',
          name: 'Leche',
          productKey: 'leche',
          quantity: 1,
          unit: 'l',
          category: 'Lácteos',
          checked: false,
          deletedAt: null,
          updatedAt: '2026-10-17 12:00:00'
        }
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    component.plan.set({
      id: 'shopping-item-update-plan',
      summary: 'Actualiza un artículo.',
      actions: [action],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-shopping-item-target"]'
    ) as HTMLElement;
    const changeSummary = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-shopping-item-changes"]'
    ) as HTMLElement;
    expect(target.textContent).toContain('Compra semanal');
    expect(target.textContent).toContain('Leche');
    expect(target.textContent).toContain('1');
    expect(changeSummary.textContent).toContain('1 → 2');
    expect(component.isActionValid(action)).toBeTrue();
    expect(component.editableFields(action).map((field) => field.path.join('.'))).toEqual([
      'changes.name',
      'changes.quantity',
      'changes.unit',
      'changes.category'
    ]);

    component.updateField(action.id, ['changes', 'quantity'], '3', 'number');
    component.updateField(action.id, ['changes', 'unit'], '');
    component.updateField(action.id, ['changes', 'category'], '  ');
    fixture.detectChanges();
    const edited = component.plan()!.actions[0]!;
    expect(edited.payload).toEqual(
      jasmine.objectContaining({
        listName: 'Compra semanal',
        targetName: 'Leche',
        changes: {
          name: null,
          setName: false,
          quantity: 3,
          setQuantity: true,
          unit: null,
          setUnit: true,
          category: null,
          setCategory: true
        }
      })
    );
    expect(component.isActionValid(edited)).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Compra semanal');
    expect(confirmation.textContent).toContain('Leche');
    expect(confirmation.textContent).toContain('1 → 3');
    expect(confirmation.textContent).toContain('l → —');
    expect(confirmation.textContent).toContain('Lácteos → —');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('validates shopping-item lengths and optional quantity/unit/category values', () => {
    const action: AssistantAction = {
      id: 'shopping-item-validation',
      kind: 'shopping.add_item',
      domain: 'shopping',
      actionType: 'add_item',
      title: 'Añadir arroz',
      summary: 'Añade arroz a la lista de la compra.',
      payload: {
        listName: 'Compra semanal',
        name: 'Arroz',
        quantity: 2,
        unit: 'kg',
        category: 'pantry'
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    expect(component.isActionValid(action)).toBeTrue();
    expect(
      component.isActionValid({
        ...action,
        payload: { ...action.payload, quantity: null, unit: null, category: null }
      })
    ).toBeTrue();
    for (const payload of [
      { ...action.payload, listName: 'x'.repeat(81) },
      { ...action.payload, name: 'x'.repeat(201) },
      { ...action.payload, quantity: 0 },
      { ...action.payload, quantity: 100001 },
      { ...action.payload, unit: 'x'.repeat(49) },
      { ...action.payload, category: 'x'.repeat(49) }
    ]) {
      expect(component.isActionValid({ ...action, payload })).toBeFalse();
    }
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('shows an ingredient preimage and keeps its reviewed pantry patch editable until approval', () => {
    const action: AssistantAction = {
      id: 'pantry-update-1',
      kind: 'pantry.update_ingredient',
      domain: 'pantry',
      actionType: 'update_ingredient',
      title: 'Actualizar yogur',
      summary: 'Deja el yogur sin existencias.',
      payload: {
        targetName: '  Yogur   natural  ',
        changes: {
          name: 'Yogur griego',
          setName: true,
          category: null,
          setCategory: false,
          quantity: 0,
          setQuantity: true,
          unit: null,
          setUnit: false,
          expirationDate: null,
          setExpirationDate: true,
          location: null,
          setLocation: false,
          notes: null,
          setNotes: false
        }
      },
      executionTarget: {
        kind: 'pantry-ingredient',
        id: 'ingredient-1',
        snapshot: {
          name: 'Yogur natural',
          category: 'dairy',
          quantity: 2,
          unit: 'unit',
          expirationDate: '2026-10-20',
          location: 'fridge',
          notes: 'Desayuno',
          updatedAt: '2026-10-16 10:00:00'
        }
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    component.plan.set({
      id: 'pantry-update-plan',
      summary: 'Actualiza un ingrediente existente.',
      actions: [action],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-pantry-target"]'
    ) as HTMLElement;
    expect(target.textContent).toContain('Yogur natural');
    expect(target.textContent).toContain('2 unit');
    expect(target.textContent).toContain('Lácteos');
    expect(target.textContent).not.toContain('dairy');
    expect(target.textContent).toContain('Desayuno');
    component.setSelected(action.id, true);
    component.stage.set('confirm');
    fixture.detectChanges();
    const confirmationTarget = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-pantry-target-confirm"]'
    ) as HTMLElement;
    expect(confirmationTarget.textContent).toContain('Lácteos');
    expect(confirmationTarget.textContent).not.toContain('dairy');
    component.stage.set('review');
    component.setSelected(action.id, false);
    fixture.detectChanges();
    expect(component.pantryCategoryName(null)).toBe('—');
    expect(component.pantryCategoryName('custom-household-category')).toBe(
      'custom-household-category'
    );
    expect(component.isActionValid(action)).toBeTrue();
    const unchangedFields = {
      name: null,
      setName: false,
      category: null,
      setCategory: false,
      quantity: null,
      setQuantity: false,
      unit: null,
      setUnit: false,
      expirationDate: null,
      setExpirationDate: false,
      location: null,
      setLocation: false,
      notes: null,
      setNotes: false
    };
    const singleFieldChanges: Array<
      Extract<AssistantAction, { kind: 'pantry.update_ingredient' }>['payload']['changes']
    > = [
      { ...unchangedFields, category: 'other', setCategory: true },
      { ...unchangedFields, quantity: 1, setQuantity: true },
      { ...unchangedFields, unit: 'g', setUnit: true },
      { ...unchangedFields, expirationDate: '2026-10-21', setExpirationDate: true },
      { ...unchangedFields, location: 'pantry', setLocation: true },
      { ...unchangedFields, notes: 'Tienda', setNotes: true }
    ];
    for (const changes of singleFieldChanges) {
      expect(
        component.isActionValid({
          ...action,
          payload: { ...action.payload, changes }
        })
      ).toBeTrue();
    }
    const categoryField = component
      .editableFields(action)
      .find((field) => field.path[1] === 'category');
    expect(categoryField?.kind).toBe('select');
    expect(categoryField?.choices).toContain(
      jasmine.objectContaining({ value: 'dairy', label: 'Lácteos' })
    );

    const details = fixture.nativeElement.querySelector(
      `[data-test="ai-assistant-action-details-${action.id}"]`
    ) as HTMLDetailsElement;
    details.open = true;
    fixture.detectChanges();
    const name = details.querySelector('input[type="text"]') as HTMLInputElement;
    name.value = 'Yogur cremoso';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    component.updateField(action.id, ['changes', 'quantity'], '0', 'number');
    component.updateField(action.id, ['changes', 'category'], 'other');
    component.updateField(action.id, ['changes', 'notes'], '', 'textarea');
    fixture.detectChanges();

    const edited = component.plan()!.actions[0];
    expect(edited.payload).toEqual(
      jasmine.objectContaining({
        targetName: '  Yogur   natural  ',
        changes: jasmine.objectContaining({
          name: 'Yogur cremoso',
          setName: true,
          quantity: 0,
          setQuantity: true,
          category: 'other',
          setCategory: true,
          notes: null,
          setNotes: true
        })
      })
    );
    expect(edited.executionTarget?.id).toBe('ingredient-1');
    expect(component.isActionValid(edited)).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Yogur natural');
    expect(confirmation.textContent).toContain('Yogur cremoso');
    expect(confirmation.textContent).toContain('0');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('shows the calendar preimage and keeps the edited event pending until explicit approval', () => {
    const action: AssistantAction = {
      id: 'calendar-update-1',
      kind: 'calendar.update_event',
      domain: 'calendar',
      actionType: 'update_event',
      title: 'Editar dentista',
      summary: 'Mueve la cita y deja el evento como día completo.',
      payload: {
        targetTitle: 'Dentista',
        targetDate: '2026-10-20',
        targetStartTime: '09:00',
        changes: { date: '2026-10-21', allDay: true }
      },
      executionTarget: {
        kind: 'calendar-event',
        id: 'event-1',
        householdId: null,
        updatedAt: '2026-10-16 10:00:00',
        snapshot: {
          title: 'Dentista',
          kind: 'appointment',
          date: '2026-10-20',
          startTime: '09:00',
          endTime: '09:30',
          allDay: false,
          color: '#60a5fa',
          notes: 'Llevar tarjeta',
          location: 'Calle Mayor',
          recurrence: 'none',
          recurrenceRule: null,
          exceptions: '[]',
          source: 'user'
        }
      },
      dependsOn: [],
      warnings: [],
      selected: false,
      status: 'pending'
    };
    component.plan.set({
      id: 'calendar-update-plan',
      summary: 'Actualiza un evento existente.',
      actions: [action],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-calendar-target"]'
    ) as HTMLElement;
    expect(target.textContent).toContain('Dentista');
    expect(target.textContent).toContain('2026-10-20');
    expect(target.textContent).toContain('09:00');
    expect(component.isActionValid(action)).toBeTrue();

    const fields = component.editableFields(action);
    expect(fields.find((field) => field.path[1] === 'title')?.value).toBe('Dentista');
    expect(fields.find((field) => field.path[1] === 'startTime')?.value).toBeNull();
    expect(fields.find((field) => field.path[1] === 'endTime')?.value).toBeNull();

    component.updateField(action.id, ['changes', 'title'], 'Dentista nuevo');
    component.updateField(action.id, ['changes', 'notes'], '');
    fixture.detectChanges();
    const edited = component.plan()!.actions[0];
    if (edited.kind !== 'calendar.update_event') throw new Error('Expected calendar action');
    expect(edited.payload).toEqual(
      jasmine.objectContaining({
        targetTitle: 'Dentista',
        targetDate: '2026-10-20',
        targetStartTime: '09:00',
        changes: jasmine.objectContaining({
          title: 'Dentista nuevo',
          date: '2026-10-21',
          allDay: true,
          notes: null
        })
      })
    );
    expect('startTime' in edited.payload.changes).toBeFalse();
    expect('endTime' in edited.payload.changes).toBeFalse();
    expect(component.isActionValid(edited)).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-confirm"]'
    ) as HTMLElement;
    expect(confirmation.textContent).toContain('Dentista');
    expect(confirmation.textContent).toContain('Dentista nuevo');
    expect(confirmation.textContent).toContain('2026-10-20');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('shows every proposed calendar value while preserving unchanged snapshot values', () => {
    const action = calendarUpdateAction({
      title: 'Dentista nuevo',
      kind: 'personal',
      date: '2026-10-22',
      startTime: '10:00',
      endTime: '10:30',
      allDay: false,
      location: 'Avenida Norte',
      notes: 'Llamar al llegar'
    });

    const fields = component.editableFields(action);
    expect(fields.map(({ value }) => value)).toEqual([
      'Dentista nuevo',
      'personal',
      '2026-10-22',
      '10:00',
      '10:30',
      false,
      'Avenida Norte',
      'Llamar al llegar'
    ]);
    expect(component.isActionValid(action)).toBeTrue();
  });

  it('rejects malformed, out-of-scope, empty, and conflicting calendar updates', () => {
    const valid = calendarUpdateAction({ title: 'Dentista' });
    const cases: Array<[string, AssistantAction]> = [
      ['wrong target kind', calendarUpdateAction({ date: '2026-10-21' }, { kind: 'other' })],
      ['missing target id', calendarUpdateAction({ date: '2026-10-21' }, { id: '' })],
      ['different household', calendarUpdateAction({ date: '2026-10-21' }, { householdId: 'h2' })],
      [
        'non-user event',
        calendarUpdateAction({ date: '2026-10-21' }, { snapshot: { source: 'household' } })
      ],
      [
        'recurring event',
        calendarUpdateAction({ date: '2026-10-21' }, { snapshot: { recurrence: 'weekly' } })
      ],
      [
        'title preimage mismatch',
        calendarUpdateAction({ date: '2026-10-21' }, { targetTitle: 'Other event' })
      ],
      [
        'date preimage mismatch',
        calendarUpdateAction({ date: '2026-10-21' }, { targetDate: '2026-10-21' })
      ],
      [
        'time preimage mismatch',
        calendarUpdateAction({ date: '2026-10-21' }, { targetStartTime: '08:00' })
      ],
      [
        'invalid snapshot date',
        calendarUpdateAction({ date: '2026-10-21' }, { snapshot: { date: '2026-02-30' } })
      ],
      ['empty patch', calendarUpdateAction({})],
      ['unknown patch field', calendarUpdateAction({ unexpected: 'value' } as never)],
      ['blank title', calendarUpdateAction({ title: '   ' })],
      ['oversized title', calendarUpdateAction({ title: 'x'.repeat(121) })],
      ['invalid kind', calendarUpdateAction({ kind: 'unknown' as never })],
      ['invalid date', calendarUpdateAction({ date: '2026-02-30' })],
      ['invalid start time', calendarUpdateAction({ startTime: '25:00' })],
      ['invalid end time', calendarUpdateAction({ endTime: '9:00' })],
      ['oversized notes', calendarUpdateAction({ notes: 'x'.repeat(501) })],
      ['oversized location', calendarUpdateAction({ location: 'x'.repeat(121) })],
      ['all-day with a timed value', calendarUpdateAction({ allDay: true, startTime: '09:00' })],
      ['all-day with an end time', calendarUpdateAction({ allDay: true, endTime: '09:30' })],
      [
        'timed event without any time',
        calendarUpdateAction({ allDay: false, startTime: null, endTime: null })
      ],
      ['end before start', calendarUpdateAction({ startTime: '11:00', endTime: '10:00' })],
      ['unchanged values', valid]
    ];

    for (const [description, action] of cases) {
      expect(component.isActionValid(action)).withContext(description).toBeFalse();
    }
  });

  it('normalizes calendar editor changes, clears times for all-day, and restores originals', () => {
    const action = calendarUpdateAction({
      date: '2026-10-21',
      startTime: '09:15',
      endTime: '09:45'
    });
    component.plan.set({
      id: 'calendar-update-plan',
      summary: 'Actualiza un evento existente.',
      actions: [action, pantryPlan().actions[0]],
      questions: []
    });
    component.updateField(action.id, ['changes', 'startTime'], '09:20');
    let edited = component.plan()!.actions[0];
    if (edited.kind !== 'calendar.update_event') throw new Error('Expected calendar update action');
    expect('allDay' in edited.payload.changes).toBeFalse();

    component.updateField(action.id, ['changes', 'allDay'], true);
    edited = component.plan()!.actions[0];
    if (edited.kind !== 'calendar.update_event') throw new Error('Expected calendar update action');
    expect(edited.payload).toEqual(
      jasmine.objectContaining({
        changes: jasmine.objectContaining({ date: '2026-10-21', allDay: true })
      })
    );
    expect('startTime' in edited.payload.changes).toBeFalse();
    expect('endTime' in edited.payload.changes).toBeFalse();

    component.updateField(action.id, ['changes', 'startTime'], '09:15');
    component.updateField(action.id, ['changes', 'location'], '   ');
    component.updateField(action.id, ['changes', 'notes'], '');
    edited = component.plan()!.actions[0];
    if (edited.kind !== 'calendar.update_event') throw new Error('Expected calendar update action');
    expect(edited.payload.changes).toEqual(
      jasmine.objectContaining({ location: null, notes: null, allDay: false })
    );
    component.updateField(action.id, ['changes', 'startTime'], '');
    component.updateField(action.id, ['changes', 'location'], '  Oficina  ');
    component.updateField(action.id, ['changes', 'notes'], '  Llamar antes  ');
    component.updateField(action.id, ['changes', 'title'], 'Otro título');
    component.updateField(action.id, ['changes', 'title'], 'Dentista');
    edited = component.plan()!.actions[0];
    if (edited.kind !== 'calendar.update_event') throw new Error('Expected calendar update action');
    expect(edited.payload.changes).toEqual({
      date: '2026-10-21',
      startTime: null,
      allDay: false,
      location: 'Oficina',
      notes: 'Llamar antes'
    });
    expect(edited.manualFields).toContain(JSON.stringify(['changes', 'allDay']));
    expect(edited.manualFields).toContain(JSON.stringify(['changes', 'startTime']));
    expect(component.isActionValid(edited)).toBeTrue();
    expect(component.plan()?.actions[1]).toEqual(pantryPlan().actions[0]);
  });

  it('formats timed, all-day, and time-less calendar snapshots for confirmation', () => {
    const action = calendarUpdateAction({ date: '2026-10-21' });
    expect(component.calendarEventTimeLabel(action)).toBe('09:00–09:30');
    expect(
      component.calendarEventTimeLabel(
        calendarUpdateAction({ date: '2026-10-21' }, { snapshot: { allDay: true } })
      )
    ).toBe('Todo el día');
    expect(
      component.calendarEventTimeLabel(
        calendarUpdateAction(
          { date: '2026-10-21' },
          {
            snapshot: { startTime: null, endTime: null }
          }
        )
      )
    ).toBe('—');
  });

  it('invalidates calendar approval when the active household changes', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const action = calendarUpdateAction({ date: '2026-10-21' }, { householdId: 'home-a' });
    assistant.propose.and.returnValue(
      of({
        id: 'calendar-household-plan',
        summary: 'Actualiza un evento propio.',
        actions: [action],
        questions: []
      })
    );
    enterPrompt('Mueve el dentista al día siguiente.');
    fixture.detectChanges();
    click('[data-test="ai-assistant-submit"]');
    fixture.detectChanges();
    expect(component.stage()).toBe('review');
    component.setSelected(action.id, true);
    component.goToConfirmation();
    expect(component.stage()).toBe('confirm');

    householdContext.activeHouseholdId.set('home-b');
    fixture.detectChanges();

    expect(component.canContinue()).toBeFalse();
    expect(component.canExecuteSelected()).toBeFalse();
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-test="ai-assistant-confirm-submit"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue();
    await component.executeSelected();
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

  it('executes selected prerequisites before dependents when proposal order is reversed', async () => {
    const plan = pantryPlan();
    const prerequisite = { ...plan.actions[0], selected: true };
    const dependent: AssistantAction = {
      ...calendarAction(),
      id: 'calendar-dependent',
      selected: true,
      dependsOn: [prerequisite.id]
    };
    component.plan.set({ ...plan, actions: [dependent, prerequisite] });
    component.stage.set('confirm');
    execution.execute.and.returnValue(Promise.resolve(undefined));

    await component.executeSelected();

    expect(execution.execute.calls.allArgs().map(([action]) => action.id)).toEqual([
      prerequisite.id,
      dependent.id
    ]);
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

  it('keeps the final speech result emitted after stopping recognition', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    const recognition = recognitions[0];
    recognition.onresult?.({
      results: [{ 0: { transcript: 'Añade avena' }, isFinal: false }]
    });

    component.stopVoice();
    expect(recognition.stopped).toBeTrue();
    recognition.onresult?.({
      results: [{ 0: { transcript: 'Añade 500 g de avena' }, isFinal: true }]
    });
    recognition.onend?.();

    expect(component.prompt()).toBe('Añade 500 g de avena');
    expect(component.voiceState()).toBe('idle');
    expect(component.voiceError()).toBeNull();
  });

  it('aborts pending finalization and ignores any later speech result when cancelled', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    const recognition = recognitions[0];

    component.stopVoice();
    component.cancelVoice();
    recognition.onresult?.({
      results: [{ 0: { transcript: 'No debe guardarse' }, isFinal: true }]
    });

    expect(recognition.aborted).toBeTrue();
    expect(component.prompt()).toBe('');
  });

  it('stops voice recognition on navigation while preserving its editable transcript', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    const recognition = recognitions[0];
    recognition.onresult?.({
      results: [{ 0: { transcript: 'Añade lentejas' }, isFinal: false }]
    });

    navigationEvents.next(new NavigationEnd(1, '/dashboard', '/shopping'));
    recognition.onresult?.({
      results: [{ 0: { transcript: 'Añade lentejas y harina' }, isFinal: true }]
    });

    expect(recognition.aborted).toBeTrue();
    expect(component.voiceState()).toBe('idle');
    expect(component.prompt()).toBe('Añade lentejas');
  });

  it('ignores end events from a cancelled recognition after a new voice session starts', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();
    const cancelledRecognition = recognitions[0];
    component.cancelVoice();

    component.startVoice();
    expect(component.voiceState()).toBe('listening');
    expect(component.supportsPause()).toBeTrue();
    cancelledRecognition.onend?.();

    expect(component.voiceState()).toBe('listening');
    expect(component.supportsPause()).toBeTrue();
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

  it('validates a complete recipe draft while keeping review read-only until confirmation', () => {
    const action = recipeAction();
    if (action.kind !== 'recipes.create_draft') throw new Error('Expected recipe draft action');
    action.payload.recipe.instructionsByLevel = {
      basic: [recipeStep('Bate los huevos.')],
      intermediate: [recipeStep('Mezcla bien los huevos.')],
      expert: [recipeStep('Cuaja la tortilla.')]
    };
    component.plan.set({
      id: 'recipe-draft-plan',
      summary: 'Prepara una tortilla.',
      actions: [action],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    expect(component.isActionValid(action)).toBeTrue();
    expect(execution.execute).not.toHaveBeenCalled();
    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    expect(component.stage()).toBe('confirm');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('shows and edits recipe preimages, then carries only reviewed edits to confirmation', () => {
    const action = recipeUpdateAction();
    component.plan.set({ id: 'recipe-update-plan', summary: '', actions: [action], questions: [] });
    component.stage.set('review');
    fixture.detectChanges();

    const target = fixture.nativeElement.querySelector('[data-test="ai-assistant-recipe-target"]');
    expect(target.textContent).toContain('Lentejas de la abuela');
    const details = fixture.nativeElement.querySelector(
      '.assistant__details'
    ) as HTMLDetailsElement;
    details.open = true;
    fixture.detectChanges();
    const ingredientChanges = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-recipe-ingredient-changes"]'
    );
    expect(ingredientChanges.textContent).toContain('Cebolla · 100 g');
    expect(ingredientChanges.textContent).toContain('Cebolla · 75 g');

    const quantityInput = ingredientChanges.querySelector(
      'input[type="number"]'
    ) as HTMLInputElement;
    quantityInput.dispatchEvent(new Event('click', { bubbles: true }));
    fixture.detectChanges();
    expect(ingredientChanges.querySelector('input[type="number"]'))
      .withContext('la detección de cambios no debe reemplazar el campo con foco')
      .toBe(quantityInput);

    quantityInput.value = '90';
    quantityInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const edited = component.plan()?.actions[0];
    expect(edited?.kind).toBe('recipes.update_content');
    if (edited?.kind !== 'recipes.update_content') throw new Error('Expected recipe update');
    expect(edited.payload.changes.ingredients[0]).toEqual(
      jasmine.objectContaining({
        operation: 'update',
        targetName: 'Cebolla',
        changes: { quantity: 90 }
      })
    );

    component.setSelected(action.id, true);
    component.goToConfirmation();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="ai-assistant-confirm"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-assistant-recipe-change-summary"]')
        .textContent
    ).toContain('90');
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it('previews every scaled recipe quantity before confirmation', () => {
    const action = recipeUpdateAction(4);
    component.plan.set({
      id: 'recipe-servings-plan',
      summary: '',
      actions: [action],
      questions: []
    });
    component.stage.set('review');
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector(
      '[data-test="ai-assistant-recipe-servings"]'
    );
    expect(preview.textContent).toContain('2 → 4');
    expect(preview.textContent).toContain('Cebolla: 100 g → 200 g');
    expect(preview.textContent).toContain('Lentejas: 200 g → 400 g');
    expect(component.isActionValid(action)).toBeTrue();
  });

  it('validates recipe additions, removals, no-ops, and stale instruction targets', () => {
    const added = recipeUpdateAction();
    added.payload.changes = {
      servings: null,
      ingredients: [
        {
          operation: 'add',
          ingredient: {
            name: 'Comino',
            quantity: 1,
            unit: 'g',
            preparation: null,
            isOptional: true,
            substitutes: [],
            notes: null
          }
        }
      ],
      instructions: []
    };
    expect(component.isActionValid(added)).toBeTrue();

    const removed = recipeUpdateAction();
    removed.payload.changes = {
      servings: null,
      ingredients: [{ operation: 'remove', targetName: 'Lentejas' }],
      instructions: []
    };
    expect(component.isActionValid(removed)).toBeTrue();

    const emptyAfterRemoval = recipeUpdateAction();
    emptyAfterRemoval.payload.changes = {
      servings: null,
      ingredients: [
        { operation: 'remove', targetName: 'Cebolla' },
        { operation: 'remove', targetName: 'Lentejas' }
      ],
      instructions: []
    };
    expect(component.isActionValid(emptyAfterRemoval)).toBeFalse();

    const duplicateTarget = recipeUpdateAction();
    duplicateTarget.payload.changes.ingredients = [
      { operation: 'remove', targetName: 'Cebolla' },
      { operation: 'remove', targetName: 'cebolla' }
    ];
    expect(component.isActionValid(duplicateTarget)).toBeFalse();

    const unchanged = recipeUpdateAction();
    unchanged.payload.changes.ingredients = [
      { operation: 'update', targetName: 'Cebolla', changes: { quantity: 100 } }
    ];
    unchanged.payload.changes.instructions = [];
    expect(component.isActionValid(unchanged)).toBeFalse();

    const missingInstruction = recipeUpdateAction();
    missingInstruction.payload.changes.ingredients = [];
    missingInstruction.payload.changes.instructions = [
      { level: 'basic', stepNumber: 2, instruction: 'Añade el comino.' }
    ];
    expect(component.isActionValid(missingInstruction)).toBeFalse();

    const unchangedInstruction = recipeUpdateAction();
    unchangedInstruction.payload.changes.ingredients = [];
    unchangedInstruction.payload.changes.instructions = [
      { level: 'basic', stepNumber: 1, instruction: 'Sofríe la cebolla.' }
    ];
    expect(component.isActionValid(unchangedInstruction)).toBeFalse();
  });

  it('rejects an invalid recipe serving scale and duplicate instruction edits', () => {
    const conflictingServings = recipeUpdateAction(4);
    conflictingServings.payload.changes.ingredients = [
      { operation: 'update', targetName: 'Cebolla', changes: { quantity: 80 } }
    ];
    expect(component.isActionValid(conflictingServings)).toBeFalse();

    const duplicateInstructions = recipeUpdateAction();
    duplicateInstructions.payload.changes.ingredients = [];
    duplicateInstructions.payload.changes.instructions = [
      { level: 'basic', stepNumber: 1, instruction: 'Dora la cebolla.' },
      { level: 'basic', stepNumber: 1, instruction: 'Añade las lentejas.' }
    ];
    expect(component.isActionValid(duplicateInstructions)).toBeFalse();

    const staleTarget = recipeUpdateAction();
    staleTarget.payload.targetName = 'Otra receta';
    expect(component.isActionValid(staleTarget)).toBeFalse();
  });

  it('preserves manually edited recipe fields by ingredient identity across refinement reordering', () => {
    const action = recipeUpdateAction();
    const replacement: AssistantActionCandidate = {
      kind: 'recipes.update_content',
      title: action.title,
      summary: 'Se revisaron cantidades.',
      payload: {
        targetName: 'Lentejas de la abuela',
        changes: {
          servings: null,
          ingredients: [
            { operation: 'update', targetName: 'Lentejas', changes: { quantity: 250 } },
            { operation: 'update', targetName: 'Cebolla', changes: { quantity: 70 } }
          ],
          instructions: action.payload.changes.instructions
        }
      },
      dependsOn: [],
      warnings: []
    };
    assistant.refine.and.returnValue(
      of({ actionId: action.id, summary: 'Se revisaron cantidades.', replacement, questions: [] })
    );
    component.plan.set({ id: 'recipe-refine-plan', summary: '', actions: [action], questions: [] });
    component.updateField(
      action.id,
      ['changes', 'ingredients', 1, 'changes', 'quantity'],
      220,
      'number'
    );
    component.beginRefine(action.id);
    component.refinementPrompt.set('Revisa las cantidades');
    component.refineCurrentAction();

    const refined = component.plan()?.actions[0];
    expect(refined?.kind).toBe('recipes.update_content');
    if (refined?.kind !== 'recipes.update_content') throw new Error('Expected recipe update');
    expect(refined.payload.changes.ingredients[0]).toEqual(
      jasmine.objectContaining({
        targetName: 'Lentejas',
        changes: { quantity: 220 }
      })
    );
    expect(refined.manualFields).toContain(
      JSON.stringify(['changes', 'ingredients', 0, 'changes', 'quantity'])
    );
  });

  it('offers recipe ingredient and instruction patch scopes', () => {
    const options = component.refinementScopeOptions(recipeUpdateAction());

    expect(options.map((option) => option.value)).toContain(
      JSON.stringify(['changes', 'ingredients'])
    );
    expect(options.map((option) => option.value)).toContain(
      JSON.stringify(['changes', 'instructions'])
    );
    expect(options.map((option) => option.value)).toContain(
      JSON.stringify(['changes', 'ingredients', 0, 'changes', 'quantity'])
    );
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

  it('reports an error when recognition ends without a transcript', () => {
    const recognitions = mountWithSpeech(FakeSpeechRecognition);
    component.voiceConsent.set(true);
    component.startVoice();

    recognitions[0].onend?.();
    fixture.detectChanges();

    expect(component.voiceState()).toBe('error');
    expect(component.voiceError()).toBe('ai_assistant.voice_error');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
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

function emptyMealShoppingPreview(): HouseholdMealShoppingPreview {
  return {
    startDate: '2026-10-19',
    endDate: '2026-10-25',
    previewId: 'a'.repeat(64),
    sharedPantry: true,
    plannedMealCount: 0,
    requiredIngredients: [],
    optionalIngredients: [],
    warnings: []
  };
}

function emptyMealShoppingApproval(): HouseholdMealShoppingApproval {
  return {
    listId: null,
    version: null,
    created: false,
    idempotent: true,
    added: 0,
    updated: 0,
    removed: 0
  };
}

function syntheticMealHousehold(): Household {
  return {
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
  } as Household;
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

function calendarUpdateAction(
  changes: CalendarEventUpdatePayload['changes'],
  overrides: {
    kind?: string;
    id?: string;
    householdId?: string | null;
    targetTitle?: string;
    targetDate?: string;
    targetStartTime?: string | null;
    snapshot?: Partial<AssistantCalendarEventUpdateExecutionTarget['snapshot']>;
  } = {}
): Extract<AssistantAction, { kind: 'calendar.update_event' }> {
  const snapshot: AssistantCalendarEventUpdateExecutionTarget['snapshot'] = {
    title: 'Dentista',
    kind: 'appointment',
    date: '2026-10-20',
    startTime: '09:00',
    endTime: '09:30',
    allDay: false,
    color: '#60a5fa',
    notes: 'Llevar tarjeta',
    location: 'Calle Mayor',
    recurrence: 'none',
    recurrenceRule: null,
    exceptions: '[]',
    source: 'user'
  };
  const target: AssistantCalendarEventUpdateExecutionTarget = {
    kind: 'calendar-event',
    id: 'event-1',
    householdId: null,
    updatedAt: '2026-10-16 10:00:00',
    snapshot: { ...snapshot, ...overrides.snapshot }
  };
  return {
    id: 'calendar-update-1',
    kind: 'calendar.update_event',
    domain: 'calendar',
    actionType: 'update_event',
    title: 'Editar dentista',
    summary: 'Actualiza un evento existente.',
    payload: {
      targetTitle: overrides.targetTitle ?? target.snapshot.title,
      targetDate: overrides.targetDate ?? target.snapshot.date,
      targetStartTime: overrides.targetStartTime ?? target.snapshot.startTime,
      changes
    },
    executionTarget: {
      ...target,
      kind: (overrides.kind ?? target.kind) as 'calendar-event',
      id: overrides.id ?? target.id,
      householdId: overrides.householdId ?? target.householdId
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

function recipeStep(instruction: string): AIRecipeResponse['instructionsByLevel']['basic'][number] {
  return {
    stepNumber: 1,
    instruction,
    duration: null,
    temperature: null,
    timerRequired: false,
    timerDuration: null,
    tips: null,
    warning: null,
    illustration: null
  };
}

function recipeUpdateAction(
  servings: number | null = null
): Extract<AssistantAction, { kind: 'recipes.update_content' }> {
  const snapshot = {
    name: 'Lentejas de la abuela',
    servings: 2,
    ingredients: [
      {
        ingredientId: null,
        name: 'Cebolla',
        quantity: 100,
        unit: 'g' as const,
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      },
      {
        ingredientId: null,
        name: 'Lentejas',
        quantity: 200,
        unit: 'g' as const,
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    steps: {
      basic: [{ stepNumber: 1, instruction: 'Sofríe la cebolla.' }],
      intermediate: [{ stepNumber: 1, instruction: 'Añade las lentejas.' }],
      expert: [{ stepNumber: 1, instruction: 'Ajusta el punto de cocción.' }]
    }
  };
  return {
    id: 'recipe-update-action',
    kind: 'recipes.update_content',
    domain: 'recipes',
    actionType: 'update_content',
    title: 'Editar lentejas',
    summary: 'Reduce cebolla y aclara el primer paso.',
    payload: {
      targetName: snapshot.name,
      changes: {
        servings,
        ingredients:
          servings === null
            ? [
                { operation: 'update', targetName: 'Cebolla', changes: { quantity: 75 } },
                { operation: 'update', targetName: 'Lentejas', changes: { quantity: 240 } }
              ]
            : [],
        instructions:
          servings === null
            ? [{ level: 'basic', stepNumber: 1, instruction: 'Dora la cebolla a fuego medio.' }]
            : []
      }
    },
    dependsOn: [],
    warnings: [],
    selected: false,
    status: 'pending',
    executionTarget: { kind: 'recipe', id: 'recipe-owned', snapshot }
  };
}
