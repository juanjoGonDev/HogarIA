import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AiService } from '../../core/services/ai.service';
import { CalendarService } from '../../core/services/calendar.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { HouseholdService } from '../../core/services/household.service';
import type { Household } from '../../shared/models/household.model';
import { I18nService } from '../../core/services/i18n.service';
import { ModulesService } from '../../core/services/modules.service';
import { PantryService } from '../../core/services/pantry.service';
import { RecipeService } from '../../core/services/recipe.service';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { ToastService } from '../../core/services/toast.service';
import { dateLocale, setDateLocale } from '../../core/time';
import type {
  CalendarHouseholdTask,
  CalendarMeal,
  HouseholdEvent
} from '../../shared/models/calendar.model';
import type { TasteGoal } from '../../shared/models/taste-profile';
import { CalendarComponent } from './calendar.component';

describe('CalendarComponent meal deletion feedback', () => {
  let fixture: ComponentFixture<CalendarComponent>;
  let component: CalendarComponent;
  let calendar: jasmine.SpyObj<CalendarService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let toast: jasmine.SpyObj<ToastService>;
  let householdService: jasmine.SpyObj<HouseholdService>;
  let aiService: jasmine.SpyObj<AiService>;
  let routeParams: BehaviorSubject<ParamMap>;
  let householdState: WritableSignal<Household | null>;
  let activeHouseholdIdState: WritableSignal<string | null>;
  let contextRevisionState: WritableSignal<number>;
  let mealPlanState: WritableSignal<Record<string, boolean>>;
  let visibleKindsState: WritableSignal<string[]>;
  let calendarMealsState: WritableSignal<CalendarMeal[]>;
  let calendarTasksState: WritableSignal<CalendarHouseholdTask[]>;
  let householdEventsState: WritableSignal<HouseholdEvent[]>;
  let calendarErrorState: WritableSignal<unknown>;
  let calendarLoadingState: WritableSignal<boolean>;
  let goalsState: WritableSignal<unknown>;
  let targetCaloriesState: WritableSignal<number>;
  let tasteLoadedState: WritableSignal<boolean>;
  let tasteProfileState: WritableSignal<{ goals: TasteGoal[]; goalNotes: string }>;
  let moduleMealsEnabledState: WritableSignal<boolean>;
  let tasteLoad: jasmine.Spy;
  let mealsByDate: Map<string, CalendarMeal[]>;
  let routerNavigate: jasmine.Spy;
  let previousLocale: string;
  let pantryService: {
    loadCaducidades: jasmine.Spy;
    caducidades: WritableSignal<{ name: string; daysLeft: number | null }[]>;
  };

  beforeEach(async () => {
    previousLocale = dateLocale();
    setDateLocale('es-ES');
    calendar = jasmine.createSpyObj<CalendarService>('CalendarService', [
      'loadRange',
      'loadHouseholdEvents',
      'deleteMeal',
      'updateMeal',
      'updateGoals',
      'toggleComplete',
      'addMeal',
      'generateWithAi',
      'refreshHouseholdEvents',
      'saveHouseholdEvent',
      'removeHouseholdEvent',
      'skipHouseholdOccurrence',
      'leaveHouseholdEvent',
      'toggleKind'
    ]);
    calendarMealsState = signal<CalendarMeal[]>([]);
    calendarTasksState = signal<CalendarHouseholdTask[]>([]);
    householdEventsState = signal<HouseholdEvent[]>([]);
    calendarErrorState = signal<unknown>(null);
    calendarLoadingState = signal(false);
    goalsState = signal<unknown>(null);
    targetCaloriesState = signal(2000);
    tasteLoadedState = signal(true);
    tasteProfileState = signal({ goals: [] as TasteGoal[], goalNotes: '' });
    moduleMealsEnabledState = signal(true);
    tasteLoad = jasmine.createSpy('load').and.callFake(() => {
      tasteLoadedState.set(true);
      return of({});
    });
    mealsByDate = new Map<string, CalendarMeal[]>();
    Object.defineProperty(calendar, 'meals', { value: calendarMealsState });
    Object.defineProperty(calendar, 'tasks', { value: calendarTasksState });
    Object.defineProperty(calendar, 'tasksByDate', {
      value: () => {
        const byDate = new Map<string, CalendarHouseholdTask[]>();
        for (const task of calendarTasksState()) {
          const list = byDate.get(task.date);
          if (list) list.push(task);
          else byDate.set(task.date, [task]);
        }
        return byDate;
      }
    });
    Object.defineProperty(calendar, 'goals', { value: goalsState });
    Object.defineProperty(calendar, 'targetCalories', { value: targetCaloriesState });
    Object.defineProperty(calendar, 'householdEvents', { value: householdEventsState });
    visibleKindsState = signal(['shopping', 'home', 'appointment', 'personal', 'other']);
    Object.defineProperty(calendar, 'visibleKinds', { value: visibleKindsState });
    Object.defineProperty(calendar, 'eventsError', { value: signal(null) });
    Object.defineProperty(calendar, 'error', { value: calendarErrorState });
    Object.defineProperty(calendar, 'isLoading', { value: calendarLoadingState });
    Object.defineProperty(calendar, 'goalType', {
      value: jasmine.createSpy('goalType').and.returnValue(null)
    });
    Object.defineProperty(calendar, 'mealsByDate', { value: () => mealsByDate });
    Object.defineProperty(calendar, 'visibleEventsOn', {
      value: jasmine
        .createSpy('visibleEventsOn')
        .and.callFake((date: string) =>
          householdEventsState().filter((event) => event.date === date)
        )
    });
    calendar.deleteMeal.and.returnValue(of(false));
    (calendar.updateMeal as jasmine.Spy).and.returnValue(of({}));
    (calendar.updateGoals as jasmine.Spy).and.returnValue(of(undefined));
    calendar.addMeal.and.returnValue(of(null));
    calendar.generateWithAi.and.returnValue(of(null));
    calendar.saveHouseholdEvent.and.returnValue(Promise.resolve({} as never));
    calendar.removeHouseholdEvent.and.returnValue(Promise.resolve(true));
    calendar.skipHouseholdOccurrence.and.returnValue(Promise.resolve(true));
    calendar.leaveHouseholdEvent.and.returnValue(Promise.resolve(true));
    confirm = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirm.confirm.and.returnValue(Promise.resolve(true));
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'warning',
      'show'
    ]);
    householdService = jasmine.createSpyObj<HouseholdService>('HouseholdService', [
      'ensureHousehold',
      'defaultServings'
    ]);
    householdService.defaultServings.and.returnValue(4);
    householdState = signal(makeHousehold('home-1', ['member-1']));
    activeHouseholdIdState = signal('home-1');
    contextRevisionState = signal(0);
    mealPlanState = signal({ breakfast: true, lunch: true, snack: true, dinner: true });
    Object.defineProperty(householdService, 'household', { value: householdState });
    Object.defineProperty(householdService, 'activeHouseholdId', { value: activeHouseholdIdState });
    Object.defineProperty(householdService, 'contextRevision', { value: contextRevisionState });
    Object.defineProperty(householdService, 'isLoading', { value: signal(false) });
    Object.defineProperty(householdService, 'membershipsLoading', { value: signal(false) });
    aiService = jasmine.createSpyObj<AiService>('AiService', ['replaceMeal']);
    aiService.replaceMeal.and.returnValue(of(null));
    routeParams = new BehaviorSubject(convertToParamMap({}));
    routerNavigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
    pantryService = {
      loadCaducidades: jasmine.createSpy('loadCaducidades'),
      caducidades: signal([])
    };
    const route = {
      queryParamMap: routeParams.asObservable(),
      get snapshot() {
        return { queryParamMap: routeParams.value };
      }
    };

    await TestBed.configureTestingModule({
      imports: [CalendarComponent],
      providers: [
        { provide: CalendarService, useValue: calendar },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: ActivatedRoute,
          useValue: route
        },
        {
          provide: Router,
          useValue: {
            navigate: routerNavigate
          }
        },
        {
          provide: RecipeService,
          useValue: { loadRecipes: jasmine.createSpy('loadRecipes'), recipes: () => [] }
        },
        {
          provide: TasteProfileService,
          useValue: {
            ensureLoaded: jasmine.createSpy('ensureLoaded'),
            mealTimes: signal({}),
            mealPlan: mealPlanState,
            isLoaded: tasteLoadedState,
            load: tasteLoad,
            taste: tasteProfileState
          }
        },
        { provide: AuthService, useValue: { userId: () => 'user-1' } },
        { provide: HouseholdService, useValue: householdService },
        { provide: AiService, useValue: aiService },
        { provide: PantryService, useValue: pantryService },
        {
          provide: ModulesService,
          useValue: {
            isEnabled: (id: string) => (id === 'meals' ? moduleMealsEnabledState() : true)
          }
        }
      ]
    })
      .overrideComponent(CalendarComponent, { set: { template: '', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(CalendarComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => setDateLocale(previousLocale));

  it('restores the selected calendar view and anchor when route query parameters change', () => {
    routeParams.next(convertToParamMap({ view: 'month', date: '2026-11-15' }));
    fixture.detectChanges();

    expect(component.view()).toBe('month');
    expect(component.anchorIso()).toBe('2026-11-15');
  });

  it('defaults a new meal to the active household size', () => {
    component.openAddModal('2026-10-05', 'dinner');

    expect(householdService.defaultServings).toHaveBeenCalled();
    expect(component.draft.servings).toBe(4);
  });

  it('resolves the currently edited meal from the live service state', () => {
    const meal: CalendarMeal = {
      id: 'meal-editing',
      date: '2026-10-05',
      mealType: 'lunch',
      title: 'Lentejas',
      servings: 2,
      completed: false
    };
    calendarMealsState.set([meal]);
    component.draft = {
      id: meal.id,
      date: meal.date,
      mealType: meal.mealType,
      customMeal: meal.title,
      recipeId: '',
      time: '',
      servings: meal.servings,
      notes: ''
    };

    expect(component.editingMeal()).toEqual(meal);
    calendarMealsState.set([{ ...meal, completed: true }]);
    expect(component.editingMeal()?.completed).toBeTrue();

    component.draft.id = 'missing-meal';
    expect(component.editingMeal()).toBeNull();
    component.draft.id = null;
    expect(component.editingMeal()).toBeNull();
  });

  it('delegates a completion toggle to CalendarService without mutating the meal draft', () => {
    const meal: CalendarMeal = {
      id: 'meal-toggle',
      date: '2026-10-05',
      mealType: 'lunch',
      title: 'Lentejas',
      servings: 2,
      completed: false
    };

    component.toggleMeal(meal);

    expect(calendar.toggleComplete).toHaveBeenCalledOnceWith(meal);
    expect(component.draft.id).toBeNull();
  });

  it('validates and saves a custom meal with normalized optional values', () => {
    component.openAddModal('2026-10-05', 'dinner', '19:30');
    component.draft.customMeal = '   ';
    expect(component.draftValid()).toBeFalse();
    component.saveMeal();
    expect(calendar.addMeal).not.toHaveBeenCalled();

    component.draft.customMeal = '  Sopa de verduras  ';
    component.draft.servings = 0;
    component.draft.notes = '   ';
    component.draft.time = '';
    calendar.addMeal.and.returnValue(of({ id: 'meal-new' } as never));
    component.saveMeal();

    expect(calendar.addMeal).toHaveBeenCalledOnceWith({
      date: '2026-10-05',
      mealType: 'dinner',
      customMeal: 'Sopa de verduras',
      recipeId: undefined,
      time: undefined,
      servings: 1,
      notes: undefined
    });
    expect(toast.success).toHaveBeenCalledWith('calendar.comida_anadida', jasmine.any(String));
    expect(component.isMealModalOpen()).toBeFalse();
  });

  it('edits a recipe meal and preserves the form after an unsuccessful response', () => {
    component.openEditModal({
      id: 'meal-1',
      date: '2026-10-05',
      mealType: 'lunch',
      title: 'Paella',
      recipeId: 'recipe-1',
      servings: 3,
      time: '14:00',
      completed: false
    });
    expect(component.draftValid()).toBeTrue();
    component.draft.notes = 'sin sal';
    calendar.updateMeal.and.returnValue(of(null));

    component.saveMeal();

    expect((calendar.updateMeal as jasmine.Spy).calls.mostRecent().args).toEqual([
      'meal-1',
      {
        customMeal: null,
        recipeId: 'recipe-1',
        time: '14:00',
        servings: 3,
        notes: 'sin sal'
      }
    ]);
    expect(component.isMealModalOpen()).toBeTrue();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'calendar.no_se_pudo_guardar');
  });

  it('opens the consumption flow instead of the editor for an assigned active calendar participant', () => {
    const permissions = {
      pantry: { view: true, edit: true, manage: false },
      recipes: { view: true, create: true, edit: true, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };
    const household = makeHousehold('home-1', ['member-1']);
    household.members[0] = {
      ...household.members[0],
      userId: 'user-1',
      permissions
    };
    household.myPermissions = permissions;
    householdState.set(household);

    const sharedMeal: CalendarMeal = {
      id: 'shared-meal-1',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Lentejas',
      servings: 4,
      completed: false,
      isShared: true,
      participantIds: ['user-1', 'user-2']
    };
    component.openEditModal(sharedMeal);

    expect(component.selectedSharedMeal()).toBe(sharedMeal);
    expect(component.selectedSharedMealHouseholdId()).toBe('home-1');
    expect(component.isMealModalOpen()).toBeFalse();
  });

  it("keeps another member's shared meal visible but marks its consumption action unavailable", () => {
    const permissions = {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };
    const household = makeHousehold('home-1', ['member-1']);
    household.members[0] = { ...household.members[0], userId: 'user-1', permissions };
    household.myPermissions = permissions;
    householdState.set(household);
    component.view.set('day');
    component.anchor.set(new Date(2026, 9, 5, 12));
    const sharedMeal: CalendarMeal = {
      id: 'shared-meal-for-other-member',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Lentejas compartidas',
      servings: 1,
      completed: false,
      isShared: true,
      participantIds: ['user-2']
    };
    mealsByDate.set(sharedMeal.date, [sharedMeal]);

    const visibleMeal = component.days()[0]?.meals[0];
    expect(visibleMeal?.title).toBe('Lentejas compartidas');
    expect(visibleMeal?.canRecordConsumption).toBeFalse();

    component.openEditModal(visibleMeal!);
    expect(component.selectedSharedMeal()).toBeNull();
    expect(component.isMealModalOpen()).toBeFalse();

    sharedMeal.participantIds = ['user-1'];
    component.view.set('week');
    component.view.set('day');
    const participantMeal = component.days()[0]?.meals[0];
    expect(participantMeal?.canRecordConsumption).toBeTrue();
    component.openEditModal(participantMeal!);
    expect(component.selectedSharedMeal()?.id).toBe(sharedMeal.id);
  });

  it('does not offer shared-meal consumption unless the current user is active, assigned and can view the calendar', () => {
    const permissions = {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };
    const household = makeHousehold('home-1', ['member-1']);
    household.members[0] = {
      ...household.members[0],
      userId: 'user-1',
      permissions,
      isActive: false
    };
    household.myPermissions = permissions;
    householdState.set(household);
    const sharedMeal: CalendarMeal = {
      id: 'shared-meal-1',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Lentejas',
      servings: 4,
      completed: false,
      isShared: true,
      participantIds: ['user-2']
    };

    component.openEditModal(sharedMeal);
    expect(component.selectedSharedMeal()).toBeNull();
    expect(component.isMealModalOpen()).toBeFalse();

    household.members[0].isActive = true;
    household.members[0].permissions = { ...permissions, calendar: { view: false, edit: false } };
    household.myPermissions = { ...permissions, calendar: { view: false, edit: false } };
    sharedMeal.participantIds = ['user-1'];
    component.openEditModal(sharedMeal);
    expect(component.selectedSharedMeal()).toBeNull();
  });

  it('closes an open shared-meal form as soon as the active household changes', () => {
    const permissions = {
      pantry: { view: true, edit: true, manage: false },
      recipes: { view: true, create: true, edit: true, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };
    const household = makeHousehold('home-1', ['member-1']);
    household.members[0] = { ...household.members[0], userId: 'user-1', permissions };
    household.myPermissions = permissions;
    householdState.set(household);
    component.openEditModal({
      id: 'shared-meal-1',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Lentejas',
      servings: 4,
      completed: false,
      isShared: true,
      participantIds: ['user-1']
    });
    expect(component.selectedSharedMeal()).not.toBeNull();

    activeHouseholdIdState.set('home-2');
    TestBed.flushEffects();
    fixture.detectChanges();

    expect(component.selectedSharedMeal()).toBeNull();
    expect(component.selectedSharedMealHouseholdId()).toBeNull();
  });

  it('edits a custom meal and supplies safe defaults for missing optional values', () => {
    component.openEditModal({
      id: 'meal-custom',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Sopa casera',
      recipeId: null,
      customMeal: null,
      servings: 0,
      time: null,
      notes: null,
      completed: false
    });

    expect(component.draft).toEqual({
      id: 'meal-custom',
      date: '2026-10-05',
      mealType: 'dinner',
      customMeal: 'Sopa casera',
      recipeId: '',
      time: '',
      servings: 1,
      notes: ''
    });
    expect(component.mealTab()).toBe('custom');
  });

  it('switches and clears the meal tab in the URL as the editor opens and closes', () => {
    component.switchAddMealTab('recipe');
    expect(routerNavigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { mealTab: 'recipe' }, queryParamsHandling: 'merge' })
    );
    routeParams.next(convertToParamMap({ mealTab: 'recipe' }));
    component.openAddModal('2026-10-05', 'lunch');
    component.closeMealModal();
    expect(routerNavigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { mealTab: null }, queryParamsHandling: 'merge' })
    );
  });

  it('computes day totals, nutrition, event counts and progress from the visible range', () => {
    const date = '2026-10-05';
    component.setView('day');
    component.jumpTo(date);
    mealsByDate.set(date, [
      {
        id: 'meal-1',
        date,
        mealType: 'breakfast',
        title: 'Avena',
        servings: 2,
        calories: 150,
        completed: true
      },
      {
        id: 'meal-2',
        date,
        mealType: 'dinner',
        title: 'Pasta',
        servings: 1,
        calories: 0,
        completed: false
      }
    ]);
    householdEventsState.set([
      { id: 'event-1', date, kind: 'home' } as HouseholdEvent,
      { id: 'event-2', date: '2026-10-06', kind: 'home' } as HouseholdEvent
    ]);

    const day = component.days()[0];
    expect(day.planned).toBe(2);
    expect(day.done).toBe(1);
    expect(day.calories).toBe(300);
    expect(day.hasNutrition).toBeTrue();
    expect(day.events.map((event) => event.id)).toEqual(['event-1']);
    expect(component.plannedCount()).toBe(2);
    expect(component.doneCount()).toBe(1);
    expect(component.calories()).toBe(300);
    expect(component.hasNutrition()).toBeTrue();
    expect(component.expectedMeals()).toBe(4);
    expect(component.plannedPercent()).toBe(50);
    expect(component.caloriePercent()).toBe(15);
    expect(component.countOf('home')).toBe(2);
    expect(component.agendaDay().iso).toBe(date);
  });

  it('shows loading/error state and clamps progress indicators', () => {
    calendarLoadingState.set(true);
    expect(component.isLoading()).toBeTrue();
    expect(component.showSkeleton()).toBeTrue();
    calendarErrorState.set('failure');
    expect(component.showSkeleton()).toBeFalse();
    calendarErrorState.set(null);

    component.setView('day');
    component.jumpTo('2026-10-05');
    mealsByDate.set('2026-10-05', [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `meal-${index}`,
        date: '2026-10-05',
        mealType: 'lunch' as const,
        title: 'Plato',
        servings: 1,
        calories: 500,
        completed: index < 3
      }))
    ]);
    expect(component.plannedPercent()).toBe(100);
    expect(component.caloriePercent()).toBe(100);
    component.showMeals.set(false);
    expect(component.days()[0].meals).toEqual([]);
    expect(component.days()[0].tasks).toEqual([]);
    expect(component.plannedCount()).toBe(0);
  });

  it('excludes adjacent-month grid days from totals and exposes the focused day', () => {
    component.jumpTo('2026-10-05');
    component.setView('month');
    expect(component.days().length).toBeGreaterThan(31);
    expect(component.countedDays()).toHaveSize(31);
    expect(component.countedDays().every((day) => day.inCurrentMonth)).toBeTrue();

    component.setView('day');
    expect(component.singleDay()?.iso).toBe(component.anchorIso());
  });

  it('labels the active date/range, selected objectives and lower bounds defensively', () => {
    component.jumpTo('2026-02-10');
    component.setView('year');
    expect(component.periodLabel()).toBe('2026');
    expect(component.periodShortLabel()).toBe('2026');
    expect(component.anchorIso()).toBe('2026-02-10');
    expect(component.anchorLabel()).toContain('10');
    component.setView('day');
    expect(component.periodLabel()).toContain('febrero');
    expect(component.periodShortLabel()).toBe('calendar.este_dia');
    component.setView('month');
    expect(component.periodLabel()).toContain('febrero');
    expect(component.periodShortLabel()).toContain('febrero');
    component.setView('agenda');
    expect(component.periodShortLabel()).toBe('calendar.view.agenda');
    expect(component.periodLabel()).toContain('2026');
    component.setView('week');
    expect(component.periodShortLabel()).toBe('calendar.esta_semana');
    expect(component.planWeekLabel()).toContain('febrero');
    component.draft.date = 'bad-date';
    expect(component.draftDateLabel()).toBe('bad-date');
    component.draft.date = '2026-02-10';
    expect(component.draftDateLabel()).toContain('2026');
    goalsState.set({ types: ['balanced', 'custom'], customInstructions: 'x' });
    expect(component.goalLabel()).toBe('calendar.goal.balanced · calendar.goal.custom');
    expect(component.goalCount()).toBe(2);
    expect(component.goalAriaLabel()).toBe(
      'calendar.objetivo: calendar.goal.balanced · calendar.goal.custom'
    );
    component.selectedGoal.set('weight-loss');
    expect(component.goalLabel()).toBe('calendar.goal.balanced · calendar.goal.custom');
    goalsState.set(null);
    expect(component.goalLabel()).toBe('taste.goal.weight-loss');
    expect(component.goalCount()).toBe(1);
    component.selectedGoal.set(null);
    (calendar.goalType as jasmine.Spy).and.returnValue('variety');
    expect(component.goalLabel()).toBe('calendar.goal.variety');
    expect(component.goalCount()).toBe(1);
    (calendar.goalType as jasmine.Spy).and.returnValue(null);
    expect(component.goalLabel()).toBe('');
    expect(component.goalCount()).toBe(0);
    expect(component.goalAriaLabel()).toBe('calendar.objetivo');
    targetCaloriesState.set(0);
    expect(component.caloriePercent()).toBe(0);
  });

  it('writes/reads calendar layers and updates kind, visibility and household state', () => {
    expect(component.metaOf('home').color).toBe('#4CAF50');
    expect(component.isKindVisible('home')).toBeTrue();
    visibleKindsState.set(['shopping']);
    expect(component.isKindVisible('home')).toBeFalse();
    component.setEventKind(null);
    expect(component.eventDraft.kind).toBe('other');
    expect(component.eventDraft.color).toBeNull();
    component.setEventKind('appointment');
    expect(component.eventDraft.kind).toBe('appointment');
    component.toggleEventMoreOptions();
    expect(component.eventMoreOptions()).toBeTrue();
    component.toggleEventMoreOptions();
    expect(component.eventMoreOptions()).toBeFalse();

    component.toggleKind('home');
    expect(calendar.toggleKind).toHaveBeenCalledOnceWith('home');
    expect(routerNavigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ layers: jasmine.any(String) })
      })
    );
    component.showMeals.set(false);
    component.writeLayers();
    expect(routerNavigate.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ queryParams: { layers: 'tasks,shopping' } })
    );

    const originalUrl = window.location.pathname + window.location.search + window.location.hash;
    try {
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}?layers=meals,home,unknown,,home`
      );
      component.readLayersFromUrl();
      expect(component.showMeals()).toBeTrue();
      expect(component.showTasks()).toBeFalse();
      expect(visibleKindsState()).toEqual(['home', 'home']);
      moduleMealsEnabledState.set(false);
      component.readLayersFromUrl();
      expect(component.showMeals()).toBeFalse();
      expect(component.showTasks()).toBeFalse();
      expect(visibleKindsState()).toEqual(['home', 'home']);
    } finally {
      window.history.replaceState({}, '', originalUrl);
      moduleMealsEnabledState.set(true);
    }
    expect(component.hasHousehold()).toBeTrue();
    householdState.set(null);
    expect(component.hasHousehold()).toBeFalse();
  });

  it('applies saved taste goals once the profile finishes loading', () => {
    tasteLoadedState.set(false);
    tasteProfileState.set({ goals: ['weight-loss', 'custom'], goalNotes: 'Mucha verdura' });

    component.openGenerateModal();

    expect(tasteLoad).toHaveBeenCalledTimes(1);
    expect(component.generateOptions.goalTypes).toEqual(['weight-loss', 'custom']);
    expect(component.generateOptions.customDescription).toBe('Mucha verdura');
    expect(component.generateGoalsReady()).toBeTrue();
    component.generateOptions.customDescription = ' ';
    expect(component.generateGoalsReady()).toBeFalse();
    component.toggleGenerateGoal('weight-loss');
    expect(component.generateOptions.goalTypes).toEqual(['custom']);
    component.toggleGenerateGoal('balanced');
    expect(component.generateOptions.goalTypes).toEqual(['balanced']);
  });

  it('opens and validates multi-objective settings without submitting an empty or incomplete goal', () => {
    goalsState.set({
      types: ['balanced', 'custom'],
      dailyCalories: 1750,
      customInstructions: 'Cenas ligeras',
      restrictions: ['sin cerdo']
    });
    component.openGoalsModal();
    expect(component.goalsDraft).toEqual({
      types: ['balanced', 'custom'],
      dailyCalories: 1750,
      customInstructions: 'Cenas ligeras'
    });
    component.toggleWeeklyGoal('balanced');
    expect(component.goalsDraft.types).toEqual([]);
    component.toggleWeeklyGoal('custom');
    expect(component.goalsDraft.types).toEqual(['custom']);
    component.goalsDraft.customInstructions = '   ';
    component.saveGoals();
    expect(calendar.updateGoals).not.toHaveBeenCalled();
    component.goalsDraft.types = [];
    component.goalsDraft.customInstructions = 'texto';
    component.saveGoals();
    expect(calendar.updateGoals).not.toHaveBeenCalled();
    component.closeGoalsModal();
    expect(component.isGoalsModalOpen()).toBeFalse();
    expect(component.goalsSaveError()).toBeFalse();
  });

  it('opens goal settings from both legacy single-goal data and the selected profile default', () => {
    goalsState.set({ type: 'maintenance', dailyCalories: 1900 });
    component.openGoalsModal();
    expect(component.goalsDraft.types).toEqual(['maintenance']);

    goalsState.set(null);
    component.selectedGoal.set('variety');
    component.openGoalsModal();
    expect(component.goalsDraft.types).toEqual(['variety']);
    expect(component.goalsDraft.dailyCalories).toBe(2000);
  });

  it('copies persisted restrictions and normalizes calories while saving weekly goals', () => {
    goalsState.set({ types: ['balanced'], dailyCalories: 2000, restrictions: ['sin nueces'] });
    component.openGoalsModal();
    component.goalsDraft.types = ['weight-loss', 'custom'];
    component.goalsDraft.dailyCalories = 1800;
    component.goalsDraft.customInstructions = '  Más verdura  ';

    component.saveGoals();

    expect(calendar.updateGoals).toHaveBeenCalledWith(
      jasmine.objectContaining({
        types: ['weight-loss', 'custom'],
        customInstructions: 'Más verdura',
        dailyCalories: 1800,
        restrictions: ['sin nueces']
      }),
      jasmine.any(String)
    );
    expect(component.selectedGoal()).toBe('weight-loss');
  });

  it('opens the planning form with allowed meals, expiry notes, default guests and participant count', () => {
    mealPlanState.set({ breakfast: true, lunch: false, snack: true, dinner: true });
    pantryService.caducidades.set([
      { name: 'Yogur', daysLeft: 2 },
      { name: 'Arroz', daysLeft: null },
      { name: 'Huevos', daysLeft: 7 },
      { name: 'Patata', daysLeft: 10 }
    ] as never);
    component.generateMemberIds.set(['old-member']);
    component.generateGuests.set([
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ]);

    component.openGenerateModal();
    fixture.detectChanges();

    expect(pantryService.loadCaducidades).toHaveBeenCalled();
    expect(component.generateOptions.mealTypes).toEqual({
      breakfast: true,
      lunch: false,
      snack: true,
      dinner: true
    });
    expect(component.caducanPronto()).toEqual(['Yogur', 'Huevos']);
    expect(component.blockedMeals()).toEqual(['lunch']);
    expect(component.blockedMealsLabel()).toBe('meal.lunch');
    expect(component.generateMealTypes).toEqual(['breakfast', 'snack', 'dinner']);
    component.generateOptions.mealTypes.breakfast = false;
    component.generateOptions.mealTypes.snack = false;
    component.generateOptions.mealTypes.dinner = false;
    expect(component.generateMealTypes).toEqual(['breakfast', 'snack', 'dinner']);
    expect(component.generateServings()).toBe(1);
    component.generateGuests.set([
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' },
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ]);
    expect(component.generateServings()).toBe(3);
    component.closeGenerateModal();
    expect(component.generateGuests()).toEqual([]);
    expect(component.generateMemberIds()).toEqual([]);
  });

  it('clears planner guests and selects only members from the newly active household', () => {
    component.openGenerateModal();
    fixture.detectChanges();
    expect(component.generateMemberIds()).toEqual(['member-1']);

    component.generateGuests.set([
      { allergies: ['huevo'], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ]);
    activeHouseholdIdState.set('home-2');
    householdState.set(makeHousehold('home-2', ['member-2']));
    contextRevisionState.update((revision) => revision + 1);
    fixture.detectChanges();

    expect(component.generateMemberIds()).toEqual(['member-2']);
    expect(component.generateGuests()).toEqual([]);
    expect(component.generateServings()).toBe(1);
  });

  it('builds an event from the clicked slot, respects a manual color and saves its series', async () => {
    component.onTimelineAddEvent({ date: '2026-10-05', startTime: '00:00' });
    expect(component.eventDraft.date).toBe('2026-10-05');
    expect(component.eventDraft.startTime).toBe('00:00');
    expect(component.eventDraft.allDay).toBeFalse();
    component.setEventKind('appointment');
    expect(component.eventDraft.color).toBeNull();
    component.eventDraft.color = '#123456';
    component.eventDraft.colorTouched = true;
    component.setEventKind('home');
    expect(component.eventDraft.kind).toBe('home');
    expect(component.eventDraft.color).toBe('#123456');
    component.eventDraft.title = '  Dentista  ';
    component.eventDraft.location = '  Centro  ';
    component.eventDraft.notes = '  Llevar tarjeta  ';
    component.eventDraft.recurrence = 'weekly';
    component.eventDraft.recurrenceRule = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [1],
      end: { type: 'never' }
    };
    component.toggleAttendee('member-1');
    expect(component.eventDraft.attendeeIds).toEqual(['member-1']);

    await component.saveEvent();

    expect(calendar.saveHouseholdEvent).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        title: 'Dentista',
        kind: 'home',
        date: '2026-10-05',
        allDay: false,
        startTime: '00:00',
        endTime: null,
        color: '#123456',
        location: 'Centro',
        notes: 'Llevar tarjeta',
        attendeeIds: ['member-1'],
        recurrence: 'weekly'
      }),
      undefined
    );
    expect(calendar.refreshHouseholdEvents).toHaveBeenCalled();
    expect(component.isEventModalOpen()).toBeFalse();
  });

  it('saves all-day events without time and leaves an invalid or rejected draft open', async () => {
    component.onTimelineAddEvent({ date: '2026-10-05', startTime: '' });
    component.eventDraft.title = '  Todo el día  ';
    component.setAllDay(true);
    component.eventDraft.startTime = '09:00';
    component.eventDraft.endTime = '10:00';
    component.eventDraft.location = ' ';
    component.eventDraft.notes = '';
    calendar.saveHouseholdEvent.and.returnValue(Promise.resolve(null));

    await component.saveEvent();

    expect(calendar.saveHouseholdEvent).toHaveBeenCalledWith(
      jasmine.objectContaining({
        title: 'Todo el día',
        allDay: true,
        startTime: null,
        endTime: null,
        location: null,
        notes: null
      }),
      undefined
    );
    expect(component.isEventModalOpen()).toBeTrue();
    component.eventDraft.title = ' ';
    await component.saveEvent();
    expect(calendar.saveHouseholdEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps an occurrence edit anchored to its original series date and derives repeat presets', () => {
    component.openEventModal(
      { iso: '2026-10-06' },
      {
        ...makeEvent('series-1', '2026-10-06'),
        recurrence: 'weekly',
        recurrenceRule: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1],
          end: { type: 'never' }
        },
        seriesDate: '2026-10-05',
        attendeeIds: ['member-1']
      }
    );

    expect(component.eventDraft.date).toBe('2026-10-05');
    expect(component.eventDraft.occurrenceDate).toBe('2026-10-06');
    expect(component.eventDraft.seriesDate).toBe('2026-10-05');
    expect(component.eventDraft.repeatPreset).toBe('weekly');
    expect(component.eventDraft.attendeeIds).toEqual(['member-1']);
    component.toggleAttendee('member-1');
    expect(component.eventDraft.attendeeIds).toEqual([]);
    component.closeEventModal();
  });

  it('does not save a household event until its title and date are valid', async () => {
    component.openEventModal({ iso: '2026-10-05' });
    component.eventDraft.title = '  ';
    await component.saveEvent();
    expect(calendar.saveHouseholdEvent).not.toHaveBeenCalled();
    component.eventDraft.title = 'Reunión';
    component.eventDraft.date = '';
    await component.saveEvent();
    expect(calendar.saveHouseholdEvent).not.toHaveBeenCalled();
  });

  it('confirms removal of a full series and handles declining the destructive action', async () => {
    component.openEventModal(
      { iso: '2026-10-05' },
      { ...makeEvent('event-1', '2026-10-05'), recurrence: 'weekly' }
    );
    confirm.confirm.and.returnValue(Promise.resolve(false));
    await component.removeEvent();
    expect(calendar.removeHouseholdEvent).not.toHaveBeenCalled();
    expect(component.isEventModalOpen()).toBeTrue();

    confirm.confirm.and.returnValue(Promise.resolve(true));
    await component.removeEvent();
    expect(calendar.removeHouseholdEvent).toHaveBeenCalledOnceWith('event-1');
    expect(component.isEventModalOpen()).toBeFalse();
    expect(toast.show).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'info', title: 'calendar.evento_borrado' })
    );
  });

  it('removes only the selected recurring occurrence and reports an unsuccessful attempt', async () => {
    component.openEventModal(
      { iso: '2026-10-06' },
      { ...makeEvent('series-1', '2026-10-06'), recurrence: 'weekly', seriesDate: '2026-10-05' }
    );
    await component.removeOccurrence();
    expect(calendar.skipHouseholdOccurrence).toHaveBeenCalledOnceWith('series-1', '2026-10-06');
    expect(component.isEventModalOpen()).toBeFalse();

    component.openEventModal(
      { iso: '2026-10-06' },
      { ...makeEvent('series-1', '2026-10-06'), recurrence: 'weekly' }
    );
    calendar.skipHouseholdOccurrence.and.returnValue(Promise.resolve(false));
    await component.removeOccurrence();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'calendar.no_se_pudo_quitar');
    expect(component.isEventModalOpen()).toBeTrue();
  });

  it('lets an attendee leave someone else’s event after confirmation', async () => {
    const event = { ...makeEvent('shared-1', '2026-10-05'), editable: false, authorName: null };
    confirm.confirm.and.returnValue(Promise.resolve(false));
    component.openEventModal({ iso: event.date }, event);
    expect(calendar.leaveHouseholdEvent).not.toHaveBeenCalled();
    expect(component.isEventModalOpen()).toBeFalse();

    confirm.confirm.and.returnValue(Promise.resolve(true));
    await component.leaveEvent(event);
    expect(calendar.leaveHouseholdEvent).toHaveBeenCalledOnceWith('shared-1');
    expect(toast.show).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: 'info', title: 'calendar.te_has_salido_del' })
    );
    calendar.leaveHouseholdEvent.and.returnValue(Promise.resolve(false));
    await component.leaveEvent(event);
    expect(toast.error).toHaveBeenCalledWith(
      'calendar.no_se_pudo_salir',
      'calendar.vuelve_a_intentarlo_en'
    );
  });

  it('proposes a guest-aware replacement and writes only after explicit apply', () => {
    const meal = {
      id: 'meal-1',
      date: '2026-10-05',
      mealType: 'dinner' as const,
      title: 'Pasta actual',
      recipeId: 'recipe-1',
      servings: 4,
      completed: false
    };
    const candidate = {
      name: 'Arroz vegetal',
      description: 'Una alternativa sencilla.',
      ingredients: ['arroz', 'calabacín'],
      estimatedTime: 25,
      servings: 4
    };
    aiService.replaceMeal.and.returnValue(of(candidate));
    component.openEditModal(meal);
    component.toggleReplacementForm();
    component.replacementMemberIds.set(['member-1']);
    component.replacementGuests.set([
      {
        allergies: ['cacahuete', 'huevo'],
        intolerances: ['lactosa'],
        diets: ['vegetariana'],
        likes: ['calabacín'],
        dislikes: ['cilantro'],
        notes: ''
      }
    ]);

    component.requestMealReplacement();

    expect(aiService.replaceMeal).toHaveBeenCalledOnceWith({
      mealId: 'meal-1',
      householdMemberIds: ['member-1'],
      guests: [
        {
          allergies: ['cacahuete', 'huevo'],
          intolerances: ['lactosa'],
          diets: ['vegetariana'],
          likes: ['calabacín'],
          dislikes: ['cilantro'],
          notes: ''
        }
      ]
    });
    expect(component.replacementCandidate()).toEqual(candidate);
    expect(calendar.updateMeal).not.toHaveBeenCalled();

    component.applyMealReplacement();

    expect(calendar.updateMeal).toHaveBeenCalledTimes(1);
    expect((calendar.updateMeal as jasmine.Spy).calls.mostRecent().args).toEqual([
      'meal-1',
      { recipeId: null, customMeal: 'Arroz vegetal' }
    ]);
    expect(toast.success).toHaveBeenCalledOnceWith('calendar.replacement_applied', 'Arroz vegetal');
    expect(component.isMealModalOpen()).toBeFalse();
  });

  it('sends full-length guest allergy details and notes to meal replacement', () => {
    const longText = 'A'.repeat(2_501);
    const meal = {
      id: 'meal-long-guest-text',
      date: '2026-10-05',
      mealType: 'dinner' as const,
      title: 'Pasta actual',
      recipeId: 'recipe-1',
      servings: 4,
      completed: false
    };
    const guest = {
      allergies: [longText],
      intolerances: [],
      diets: [],
      likes: [],
      dislikes: [],
      notes: longText
    };
    aiService.replaceMeal.and.returnValue(of(null));
    component.openEditModal(meal);
    component.toggleReplacementForm();
    component.replacementMemberIds.set(['member-1']);
    component.updateReplacementGuests([guest]);

    component.requestMealReplacement();

    expect(aiService.replaceMeal).toHaveBeenCalledOnceWith({
      mealId: meal.id,
      householdMemberIds: ['member-1'],
      guests: [guest]
    });
  });

  it('does not persist a failed proposal and allows a retry to be confirmed', () => {
    const meal = {
      id: 'meal-retry',
      date: '2026-10-05',
      mealType: 'dinner' as const,
      title: 'Pasta original',
      recipeId: 'recipe-1',
      servings: 2,
      completed: false
    };
    const failedRequest = new Subject<{
      name: string;
      description: string;
      ingredients: string[];
      estimatedTime: number;
      servings: number;
    } | null>();
    const retryRequest = new Subject<{
      name: string;
      description: string;
      ingredients: string[];
      estimatedTime: number;
      servings: number;
    } | null>();
    aiService.replaceMeal.and.returnValues(
      failedRequest.asObservable(),
      retryRequest.asObservable()
    );
    component.openEditModal(meal);
    component.toggleReplacementForm();

    component.requestMealReplacement();
    failedRequest.error(new Error('network unavailable'));

    expect(component.replacementFailed()).toBeTrue();
    expect(component.replacementCandidate()).toBeNull();
    expect(calendar.updateMeal).not.toHaveBeenCalled();

    component.requestMealReplacement();
    retryRequest.next({
      name: 'Sopa de verduras',
      description: 'Alternativa de prueba.',
      ingredients: ['zanahoria', 'patata'],
      estimatedTime: 20,
      servings: 2
    });

    expect(component.replacementFailed()).toBeFalse();
    expect(calendar.updateMeal).not.toHaveBeenCalled();
    component.applyMealReplacement();
    expect(calendar.updateMeal).toHaveBeenCalledOnceWith('meal-retry', {
      recipeId: null,
      customMeal: 'Sopa de verduras'
    } as never);
  });

  it('cancels an in-flight proposal when the meal editor closes without saving', () => {
    const pending = new Subject<{
      name: string;
      description: string;
      ingredients: string[];
      estimatedTime: number;
      servings: number;
    } | null>();
    aiService.replaceMeal.and.returnValue(pending.asObservable());
    component.openEditModal({
      id: 'meal-cancel',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Pasta original',
      recipeId: 'recipe-1',
      servings: 2,
      completed: false
    });
    component.toggleReplacementForm();
    component.requestMealReplacement();
    expect(pending.observed).toBeTrue();

    component.closeMealModal();
    pending.next({
      name: 'No debe guardarse',
      description: 'Propuesta descartada.',
      ingredients: ['arroz'],
      estimatedTime: 10,
      servings: 2
    });

    expect(pending.observed).toBeFalse();
    expect(component.replacementCandidate()).toBeNull();
    expect(calendar.updateMeal).not.toHaveBeenCalled();
  });

  it('invalidates an in-flight replacement and selects only members of the newly active household', () => {
    const meal = {
      id: 'meal-1',
      date: '2026-10-05',
      mealType: 'dinner' as const,
      title: 'Pasta actual',
      recipeId: 'recipe-1',
      servings: 4,
      completed: false
    };
    const pending = new Subject<{
      name: string;
      description: string;
      ingredients: string[];
      estimatedTime: number;
      servings: number;
    } | null>();
    aiService.replaceMeal.and.returnValue(pending.asObservable());
    component.openEditModal(meal);
    component.toggleReplacementForm();
    fixture.detectChanges();
    component.updateReplacementGuests([
      {
        allergies: ['huevo'],
        intolerances: [],
        diets: [],
        likes: [],
        dislikes: [],
        notes: ''
      }
    ]);
    component.requestMealReplacement();
    expect(component.isReplacingMeal()).toBeTrue();

    activeHouseholdIdState.set('home-2');
    householdState.set(makeHousehold('home-2', ['member-2']));
    contextRevisionState.set(1);
    fixture.detectChanges();

    expect(component.replacementMemberIds()).toEqual(['member-2']);
    expect(component.replacementGuests()).toEqual([]);
    expect(component.isReplacingMeal()).toBeFalse();
    pending.next({
      name: 'Resultado obsoleto',
      description: '',
      ingredients: [],
      estimatedTime: 1,
      servings: 1
    });
    expect(component.replacementCandidate()).toBeNull();
    expect(calendar.updateMeal).not.toHaveBeenCalled();
  });

  it('announces a confirmed deletion and closes the meal editor', async () => {
    calendar.deleteMeal.and.returnValue(of(true));
    component.isMealModalOpen.set(true);

    await component.removeMealById('meal-1', 'Synthetic meal');

    expect(toast.success).toHaveBeenCalledOnceWith('calendar.quitada', 'calendar.ya_no_esta_en_el');
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.isMealModalOpen()).toBeFalse();
    expect(component.mealDeletionFailed()).toBeFalse();
  });

  it('announces a failed deletion without claiming success or closing the editor', async () => {
    calendar.deleteMeal.and.returnValue(of(false));
    component.isMealModalOpen.set(true);

    await component.removeMealById('meal-1', 'Synthetic meal');

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(component.isMealModalOpen()).toBeTrue();
    expect(component.mealDeletionFailed()).toBeTrue();

    component.closeMealModal();
    expect(component.mealDeletionFailed()).toBeFalse();
  });

  it('does not issue a delete when confirmation is declined', async () => {
    confirm.confirm.and.returnValue(Promise.resolve(false));
    component.isMealModalOpen.set(true);

    await component.removeMealById('meal-1', 'Synthetic meal');

    expect(calendar.deleteMeal).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.isMealModalOpen()).toBeTrue();
    expect(component.mealDeletionFailed()).toBeFalse();
  });

  it('uses a translated fallback title when deleting without a supplied, saved, or draft title', async () => {
    await component.removeMealById('missing-meal');

    expect(confirm.confirm).toHaveBeenCalledWith(
      jasmine.objectContaining({
        title: 'calendar.eliminar_comida',
        message: 'calendar.quitar_de_la_planificacion',
        confirmText: 'common.delete'
      })
    );
    expect(calendar.deleteMeal).toHaveBeenCalledOnceWith('missing-meal');
  });

  it('keeps plural goal edits open and makes no success claim when saving fails', () => {
    const request = new Subject<unknown>();
    (calendar.updateGoals as jasmine.Spy).and.returnValue(request.asObservable());
    component.isGoalsModalOpen.set(true);
    component.goalsDraft = {
      types: ['weight-loss', 'custom'],
      dailyCalories: 1850,
      customInstructions: 'Más legumbres y cenas sencillas.'
    };
    component.selectedGoal.set('balanced');

    component.saveGoals();
    request.error(new Error('synthetic PATCH failure'));

    expect(component.isGoalsModalOpen()).toBeTrue();
    expect(component.goalsDraft).toEqual({
      types: ['weight-loss', 'custom'],
      dailyCalories: 1850,
      customInstructions: 'Más legumbres y cenas sencillas.'
    });
    expect(component.selectedGoal()).toBe('balanced');
    expect(component.isSavingGoals()).toBeFalse();
    expect(component.goalsSaveError()).toBeTrue();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps the plural goal draft pending until the PATCH succeeds', () => {
    const request = new Subject<unknown>();
    (calendar.updateGoals as jasmine.Spy).and.returnValue(request.asObservable());
    component.isGoalsModalOpen.set(true);
    component.goalsDraft = {
      types: ['weight-loss', 'custom'],
      dailyCalories: 1850,
      customInstructions: 'Más legumbres y cenas sencillas.'
    };
    component.selectedGoal.set('balanced');

    component.saveGoals();

    expect(component.isGoalsModalOpen()).toBeTrue();
    expect(component.isSavingGoals()).toBeTrue();
    expect(component.goalsSaveError()).toBeFalse();
    expect(component.goalsDraft.types).toEqual(['weight-loss', 'custom']);
    expect(component.selectedGoal()).toBe('balanced');
    expect(toast.success).not.toHaveBeenCalled();

    component.closeGoalsModal();
    expect(component.isGoalsModalOpen()).toBeTrue();

    request.next(undefined);
    request.complete();

    expect(component.isGoalsModalOpen()).toBeFalse();
    expect(component.isSavingGoals()).toBeFalse();
    expect(component.selectedGoal()).toBe('weight-loss');
    expect(toast.success).toHaveBeenCalledOnceWith(
      'ui.guardado',
      'calendar.objetivos_de_la_semana'
    );
  });

  it('rejects an invalid custom plan before entering the busy state', () => {
    component.generateOptions.goalTypes = ['custom'];
    component.generateOptions.customDescription = '   ';

    component.generateWeeklyPlan();

    expect(calendar.generateWithAi).not.toHaveBeenCalled();
    expect(component.isGenerating()).toBeFalse();
  });

  it('sends a valid multi-goal plan for selected meals, people and guests and handles success', () => {
    component.jumpTo('2026-10-07');
    component.generateOptions.goalTypes = ['balanced', 'custom'];
    component.generateOptions.customDescription = 'Más verduras';
    component.generateOptions.calories = 1900;
    component.generateOptions.mealTypes = {
      breakfast: false,
      lunch: true,
      snack: false,
      dinner: true
    };
    component.generateMemberIds.set(['member-1']);
    component.generateGuests.set([
      {
        allergies: ['cacahuete'],
        intolerances: [],
        diets: [],
        likes: [],
        dislikes: [],
        notes: 'sin picante'
      }
    ]);
    calendar.generateWithAi.and.returnValue(of({ saved: { created: 2, skipped: 1 } } as never));

    component.generateWeeklyPlan();

    expect(calendar.generateWithAi).toHaveBeenCalledOnceWith({
      startDate: '2026-10-05',
      endDate: '2026-10-11',
      goals: {
        types: ['balanced', 'custom'],
        caloriesTarget: 1900,
        customInstructions: 'Más verduras'
      },
      mealTypes: ['lunch', 'dinner'],
      householdMemberIds: ['member-1'],
      guests: [
        {
          allergies: ['cacahuete'],
          intolerances: [],
          diets: [],
          likes: [],
          dislikes: [],
          notes: 'sin picante'
        }
      ]
    });
    expect(calendar.loadRange).toHaveBeenCalled();
    expect(calendar.loadHouseholdEvents).toHaveBeenCalled();
    expect(component.isGenerateModalOpen()).toBeFalse();
    expect(component.isGenerating()).toBeFalse();
    expect(toast.success).toHaveBeenCalledWith('calendar.plan_guardado', jasmine.any(String));
    expect((toast.success as jasmine.Spy).calls.mostRecent().args[1]).toContain(
      'calendar.hueco_ocupado_uno'
    );
  });

  it('reports an empty AI plan without closing the dialog', () => {
    calendar.generateWithAi.and.returnValue(of({ saved: null } as never));
    component.isGenerateModalOpen.set(true);

    component.generateWeeklyPlan();

    expect(component.isGenerateModalOpen()).toBeTrue();
    expect(component.isGenerating()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'calendar.la_ia_no_devolvio');
  });

  it('closes the goal editor and confirms only after the server accepts the update', () => {
    (calendar.updateGoals as jasmine.Spy).and.returnValue(of(undefined));
    component.isGoalsModalOpen.set(true);
    component.goalsDraft = {
      types: ['weight-loss', 'custom'],
      dailyCalories: 1850,
      customInstructions: 'Más legumbres y cenas sencillas.'
    };

    component.saveGoals();

    expect(component.isGoalsModalOpen()).toBeFalse();
    expect(component.selectedGoal()).toBe('weight-loss');
    expect(toast.success).toHaveBeenCalledOnceWith(
      'ui.guardado',
      'calendar.objetivos_de_la_semana'
    );
  });

  it('keeps the edited objectives for a retry after a failed PATCH', () => {
    const failedRequest = new Subject<unknown>();
    const retryRequest = new Subject<unknown>();
    (calendar.updateGoals as jasmine.Spy).and.returnValues(
      failedRequest.asObservable(),
      retryRequest.asObservable()
    );
    component.isGoalsModalOpen.set(true);
    component.goalsDraft = {
      types: ['weight-loss', 'custom'],
      dailyCalories: 1850,
      customInstructions: 'Más legumbres y cenas sencillas.'
    };
    component.selectedGoal.set('balanced');

    component.saveGoals();
    failedRequest.error(new Error('synthetic PATCH failure'));

    expect(component.isGoalsModalOpen()).toBeTrue();
    expect(component.goalsSaveError()).toBeTrue();
    expect(component.goalsDraft.types).toEqual(['weight-loss', 'custom']);
    expect(component.selectedGoal()).toBe('balanced');

    component.saveGoals();

    expect(calendar.updateGoals).toHaveBeenCalledTimes(2);
    expect((calendar.updateGoals as jasmine.Spy).calls.argsFor(1)).toEqual(
      (calendar.updateGoals as jasmine.Spy).calls.argsFor(0)
    );
    expect(component.isGoalsModalOpen()).toBeTrue();
    expect(component.isSavingGoals()).toBeTrue();
    expect(component.goalsSaveError()).toBeFalse();
    expect(toast.success).not.toHaveBeenCalled();

    retryRequest.next(undefined);
    retryRequest.complete();

    expect(component.isGoalsModalOpen()).toBeFalse();
    expect(component.isSavingGoals()).toBeFalse();
    expect(component.selectedGoal()).toBe('weight-loss');
    expect(toast.success).toHaveBeenCalledOnceWith(
      'ui.guardado',
      'calendar.objetivos_de_la_semana'
    );
  });

  it('maps accessible calendar keyboard shortcuts to navigation and views', () => {
    component.setView('week');
    const before = component.anchorIso();
    const next = keydown('ArrowRight');
    component.onKeydown(next);
    expect(component.anchorIso()).not.toBe(before);
    expect(next.preventDefault).toHaveBeenCalled();

    const cases = [
      ['d', 'day'],
      ['4', 'fourDays'],
      ['s', 'week'],
      ['m', 'month'],
      ['y', 'year'],
      ['a', 'agenda']
    ] as const;
    for (const [key, expected] of cases) {
      const event = keydown(key);
      component.onKeydown(event);
      expect(component.view()).toBe(expected);
      expect(event.preventDefault).toHaveBeenCalled();
    }

    const today = keydown('T');
    component.setView('year');
    component.onKeydown(today);
    expect(component.anchor().getFullYear()).toBe(new Date().getFullYear());
    expect(component.anchor().getMonth()).toBe(new Date().getMonth());
    expect(component.anchor().getDate()).toBe(new Date().getDate());
    expect(today.preventDefault).toHaveBeenCalled();
  });

  it('ignores shortcuts with modifiers, an open dialog, editable controls, or an unknown key', () => {
    const modified = keydown('d', { ctrlKey: true });
    component.onKeydown(modified);
    expect(modified.preventDefault).not.toHaveBeenCalled();

    const alreadyHandled = keydown('d', { defaultPrevented: true });
    component.onKeydown(alreadyHandled);
    expect(alreadyHandled.preventDefault).not.toHaveBeenCalled();

    component.isEventModalOpen.set(true);
    const modal = keydown('d');
    component.onKeydown(modal);
    expect(modal.preventDefault).not.toHaveBeenCalled();
    component.isEventModalOpen.set(false);

    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const event = keydown('d', { target: { tagName, isContentEditable: false } as HTMLElement });
      component.onKeydown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const editable = keydown('d', {
      target: { tagName: 'DIV', isContentEditable: true } as HTMLElement
    });
    component.onKeydown(editable);
    expect(editable.preventDefault).not.toHaveBeenCalled();

    const unknown = keydown('x');
    component.onKeydown(unknown);
    expect(unknown.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps invalid navigation values inert and handles view/date jumps', () => {
    const originalDate = component.anchorIso();
    component.setViewFromPicker(null);
    component.setViewFromPicker('unknown');
    component.jumpTo('not-a-date');
    expect(component.view()).toBe('week');
    expect(component.anchorIso()).toBe(originalDate);

    component.setViewFromPicker('month');
    component.jumpTo('2026-11-23');
    expect(component.view()).toBe('month');
    expect(component.anchorIso()).toBe('2026-11-23');
    component.openDayFor('invalid');
    expect(component.view()).toBe('day');
    expect(component.anchorIso()).toBe('2026-11-23');
    component.openMonthFor('2026-12-02');
    expect(component.view()).toBe('month');
    expect(component.anchorIso()).toBe('2026-12-02');
  });

  it('writes canonical calendar URLs and replaces malformed or legacy parameters', () => {
    const writeUrl = (component as unknown as { writeViewInUrl: () => void }).writeViewInUrl.bind(
      component
    );
    const today = component.anchorIso();

    routeParams.next(convertToParamMap({ view: 'day', date: null }));
    fixture.detectChanges();
    routerNavigate.calls.reset();
    writeUrl();
    expect(routerNavigate).not.toHaveBeenCalled();

    routeParams.next(convertToParamMap({ view: 'bogus', date: 'not-a-date' }));
    fixture.detectChanges();
    routerNavigate.calls.reset();
    writeUrl();
    expect(routerNavigate).toHaveBeenCalledWith([], jasmine.objectContaining({ replaceUrl: true }));

    routeParams.next(convertToParamMap({ view: 'week', date: '2000-01-01' }));
    fixture.detectChanges();
    routerNavigate.calls.reset();
    writeUrl();
    expect(routerNavigate).toHaveBeenCalledWith([], jasmine.objectContaining({ replaceUrl: true }));

    routeParams.next(convertToParamMap({ view: 'month', date: '2000-01-01' }));
    fixture.detectChanges();
    component.setView('day');
    routerNavigate.calls.reset();
    writeUrl();
    expect(routerNavigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ replaceUrl: false })
    );

    routeParams.next(convertToParamMap({ view: 'day', date: today }));
    fixture.detectChanges();
    routerNavigate.calls.reset();
    component.setView('month');
    writeUrl();
    expect(routerNavigate).toHaveBeenCalledWith([], jasmine.objectContaining({ replaceUrl: true }));
  });

  it('supports repeat presets and rejects unsupported selections without corrupting the draft', () => {
    component.eventDraft.date = '2026-10-05';
    component.setRecurrence('daily');
    expect(component.eventDraft).toEqual(
      jasmine.objectContaining({
        recurrence: 'daily',
        repeatPreset: 'daily',
        recurrenceRule: null
      })
    );
    component.setRecurrence('weekdays');
    expect(component.eventDraft.recurrenceRule).toEqual(
      jasmine.objectContaining({
        frequency: 'weekly',
        weekdays: [1, 2, 3, 4, 5],
        end: { type: 'never' }
      })
    );
    component.setRecurrence('monthly');
    expect(component.eventDraft.recurrenceRule?.frequency).toBe('monthly');
    component.setRecurrence('yearly');
    expect(component.eventDraft.recurrenceRule?.frequency).toBe('yearly');
    component.setRecurrence('weekly');
    expect(component.eventDraft).toEqual(
      jasmine.objectContaining({
        recurrence: 'weekly',
        repeatPreset: 'weekly',
        recurrenceRule: null
      })
    );
    component.setRecurrence('none');
    expect(component.eventDraft).toEqual(
      jasmine.objectContaining({
        recurrence: 'none',
        repeatPreset: 'none',
        recurrenceRule: null
      })
    );

    component.setRecurrence(null);
    component.setRecurrence('not-a-preset');
    expect(component.eventDraft.repeatPreset).toBe('none');
    component.setRecurrence('custom');
    expect(component.isRecurrenceModalOpen()).toBeTrue();
    expect(component.eventDraft.repeatPreset).toBe('custom');
    expect(component.customRecurrenceDraft).toEqual(
      jasmine.objectContaining({ frequency: 'weekly', weekdays: [1] })
    );
    component.cancelCustomRecurrence();
    expect(component.isRecurrenceModalOpen()).toBeFalse();
    expect(component.eventDraft.repeatPreset).toBe('none');
  });

  it('validates custom recurrence interval, weekdays, and end rules before applying', () => {
    component.eventDraft.date = '2026-10-05';
    component.setRecurrence('custom');
    component.customRecurrenceDraft = {
      frequency: 'weekly',
      interval: 100,
      weekdays: [],
      end: { type: 'never' }
    };
    component.applyCustomRecurrence();
    expect(component.isRecurrenceModalOpen()).toBeTrue();
    expect(component.customRecurrenceError).toBe('calendar.repeat_invalid');

    component.setCustomFrequency('not-a-frequency');
    expect(component.customRecurrenceDraft.frequency).toBe('weekly');
    component.setCustomFrequency('daily');
    expect(component.customRecurrenceDraft.weekdays).toBeUndefined();
    component.setCustomFrequency('weekly');
    expect(component.customRecurrenceDraft.weekdays).toEqual([1]);
    component.toggleCustomWeekday(1);
    component.applyCustomRecurrence();
    expect(component.customRecurrenceError).toBe('calendar.repeat_invalid');
    component.toggleCustomWeekday(3);

    component.customRecurrenceDraft.interval = 2;
    component.customEndType = 'date';
    component.customEndDate = '2026-10-04';
    component.applyCustomRecurrence();
    expect(component.customRecurrenceError).toBe('calendar.repeat_invalid');
    component.customEndDate = '2026-10-19';
    component.applyCustomRecurrence();
    expect(component.eventDraft.recurrenceRule).toEqual(
      jasmine.objectContaining({
        frequency: 'weekly',
        interval: 2,
        weekdays: [3],
        end: { type: 'date', date: '2026-10-19' }
      })
    );
    expect(component.eventDraft.recurrence).toBe('weekly');
    expect(component.isRecurrenceModalOpen()).toBeFalse();

    component.setRecurrence('custom');
    component.customEndType = 'count';
    component.customEndCount = 1000;
    component.applyCustomRecurrence();
    expect(component.customRecurrenceError).toBe('calendar.repeat_invalid');
    component.customEndCount = 4;
    component.applyCustomRecurrence();
    expect(component.eventDraft.recurrenceRule?.end).toEqual({ type: 'count', count: 4 });
  });
});

function keydown(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    preventDefault: jasmine.createSpy('preventDefault'),
    ...overrides
  } as unknown as KeyboardEvent;
}

function makeHousehold(id: string, memberIds: string[]): Household {
  return {
    id,
    name: `Hogar ${id}`,
    inviteCode: 'SYNTHETIC',
    members: memberIds.map((memberId) => ({
      id: memberId,
      userId: `user-${memberId}`,
      name: memberId,
      email: 'fixture@invalid.test',
      role: 'admin',
      cookingLevel: 'beginner',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
      isActive: true
    })),
    sharedPantry: true,
    shareRecipes: true,
    shareCalendar: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  };
}

function makeEvent(id: string, date: string): HouseholdEvent {
  return {
    id,
    title: 'Synthetic event',
    kind: 'other',
    date,
    startTime: '10:00',
    endTime: '11:00',
    allDay: false,
    color: null,
    notes: null,
    location: null,
    source: 'household',
    userId: 'user-1',
    authorName: 'Fixture',
    editable: true
  };
}
