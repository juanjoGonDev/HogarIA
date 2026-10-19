import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { AiService } from '../../core/services/ai.service';
import { AiQueueService } from '../../core/services/ai-queue.service';
import { AuthService } from '../../core/services/auth.service';
import { CalendarService } from '../../core/services/calendar.service';
import { DashboardPreferencesService } from '../../core/services/dashboard-preferences.service';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { PantryService } from '../../core/services/pantry.service';
import { RecipeService } from '../../core/services/recipe.service';
import type { AIProviderConfig } from '../../shared/models/ai-config.model';
import type { AiQueueJob, AiQueueState } from '../../shared/models/ai-queue.model';
import type { HouseholdMembership } from '../../shared/models/household.model';
import type { CaducidadRow } from '../../shared/models/caducidades.model';
import type { CalendarMeal } from '../../shared/models/calendar.model';
import { DashboardComponent } from './dashboard.component';
import { localIsoDate, localIsoDateOffset } from './dashboard-meals.util';

function expiryRow(name: string, daysLeft: number | null): CaducidadRow {
  return {
    id: name,
    name,
    category: 'other',
    quantity: 1,
    unit: 'unit',
    expirationDate: null,
    estimatedDays: null,
    shelfSource: daysLeft === null ? null : 'fecha',
    vence: null,
    daysLeft,
    cadaDias: null,
    unidadesPorCompra: null,
    duraDias: null,
    lastBought: null
  };
}

function plannedMeal(id: string, date: string): CalendarMeal {
  return {
    id,
    date,
    mealType: 'lunch',
    title: id,
    servings: 1,
    completed: false,
    time: '14:00'
  };
}

function aiConfig(id: string, concurrency = 1): AIProviderConfig {
  return {
    id,
    name: `Provider ${id}`,
    provider: 'custom',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: '',
    model: 'fixture-model',
    temperature: 0.7,
    maxTokens: 256,
    timeout: 1000,
    retryAttempts: 0,
    concurrency,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z')
  };
}

function membership(id: string, settings: boolean): HouseholdMembership {
  return {
    id,
    name: `Home ${id}`,
    role: 'member',
    active: true,
    permissions: {
      pantry: { view: true, edit: true, manage: true },
      recipes: { view: true, create: true, edit: true, delete: true, generateAI: true },
      calendar: { view: true, edit: true },
      members: { invite: true, kick: true, manageRoles: true },
      settings
    }
  };
}

function queueJob(id: string, configId: string, status: AiQueueJob['status']): AiQueueJob {
  return {
    id,
    configId,
    kind: 'recipe',
    status,
    attempts: 0,
    maxAttempts: 3,
    error: null,
    retryable: false,
    createdAt: '2026-10-08T08:00:00.000Z',
    queueOrder: 0
  };
}

function queueState(
  configId: string,
  jobs: AiQueueJob[] = [],
  overrides: Partial<AiQueueState> = {}
): AiQueueState {
  return {
    snapshot: { configId, jobs },
    loading: false,
    loadError: false,
    mutating: false,
    actionError: false,
    ...overrides
  };
}

describe('DashboardComponent', () => {
  let pantry: {
    caducidades: ReturnType<typeof signal<CaducidadRow[]>>;
    cargandoCaducidades: ReturnType<typeof signal<boolean>>;
    caducidadesError: ReturnType<typeof signal<boolean>>;
    stats: ReturnType<typeof signal<{ totalItems: number }>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    loadIngredients: jasmine.Spy;
    loadStats: jasmine.Spy;
    loadCaducidades: jasmine.Spy;
  };
  let recipes: {
    recipes: ReturnType<typeof signal<Array<Record<string, unknown>>>>;
    total: ReturnType<typeof signal<number>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    loadRecipes: jasmine.Spy;
  };
  let calendar: {
    meals: ReturnType<typeof signal<CalendarMeal[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<boolean>>;
    range: ReturnType<typeof signal<{ start: string; end: string } | null>>;
    loadRange: jasmine.Spy;
    getMealsForRange: jasmine.Spy;
  };
  let household: {
    household: ReturnType<typeof signal<{ members: unknown[] } | null>>;
    memberships: ReturnType<typeof signal<HouseholdMembership[]>>;
    membershipsFailed: ReturnType<typeof signal<boolean>>;
    activeHouseholdId: ReturnType<typeof signal<string | null>>;
    contextRevision: ReturnType<typeof signal<number>>;
    ensureMemberships: jasmine.Spy;
    loadHousehold: jasmine.Spy;
    ensureHousehold: jasmine.Spy;
  };
  let ai: {
    configs: ReturnType<typeof signal<AIProviderConfig[]>>;
    configsLoading: ReturnType<typeof signal<boolean>>;
    configsError: ReturnType<typeof signal<boolean>>;
    loadConfigsSnapshot: jasmine.Spy;
  };
  let aiQueue: {
    stateFor: jasmine.Spy;
    watch: jasmine.Spy;
    refreshQueue: jasmine.Spy;
  };
  let queueStates: Map<string, ReturnType<typeof signal<AiQueueState>>>;
  let stoppedQueueWatchers: string[];
  let preferences: { expiryHorizonDays: ReturnType<typeof signal<number>> };
  let translate: jasmine.Spy;
  let userName: jasmine.Spy;

  beforeEach(() => {
    userName = jasmine.createSpy('userName').and.returnValue('Ada');
    translate = jasmine
      .createSpy('translate')
      .and.callFake((key: string, params?: { days?: number }) => {
        if (key === 'dashboard.expiryStatusDays') return `In ${params?.days} days`;
        return key;
      });
    pantry = {
      caducidades: signal<CaducidadRow[]>([]),
      cargandoCaducidades: signal(false),
      caducidadesError: signal(false),
      stats: signal({ totalItems: 4 }),
      isLoading: signal(false),
      loadIngredients: jasmine.createSpy('loadIngredients'),
      loadStats: jasmine.createSpy('loadStats'),
      loadCaducidades: jasmine.createSpy('loadCaducidades')
    };
    recipes = {
      recipes: signal<Array<Record<string, unknown>>>([]),
      total: signal(9),
      isLoading: signal(false),
      loadRecipes: jasmine.createSpy('loadRecipes')
    };
    calendar = {
      meals: signal<CalendarMeal[]>([]),
      isLoading: signal(false),
      error: signal(false),
      range: signal(null),
      loadRange: jasmine.createSpy('loadRange'),
      getMealsForRange: jasmine.createSpy('getMealsForRange').and.returnValue(of([]))
    };
    household = {
      household: signal({ members: [{}] }),
      memberships: signal<HouseholdMembership[]>([]),
      membershipsFailed: signal(false),
      activeHouseholdId: signal<string | null>(null),
      contextRevision: signal(0),
      ensureMemberships: jasmine
        .createSpy('ensureMemberships')
        .and.callFake(() => of(household.memberships())),
      loadHousehold: jasmine.createSpy('loadHousehold'),
      ensureHousehold: jasmine.createSpy('ensureHousehold')
    };
    ai = {
      configs: signal<AIProviderConfig[]>([]),
      configsLoading: signal(false),
      configsError: signal(false),
      loadConfigsSnapshot: jasmine.createSpy('loadConfigsSnapshot').and.returnValue(of([]))
    };
    queueStates = new Map();
    stoppedQueueWatchers = [];
    aiQueue = {
      stateFor: jasmine.createSpy('stateFor').and.callFake((configId: string) => {
        if (!queueStates.has(configId)) {
          queueStates.set(configId, signal(queueState(configId)));
        }
        return queueStates.get(configId)!.asReadonly();
      }),
      watch: jasmine.createSpy('watch').and.callFake((configId: string) => {
        if (!queueStates.has(configId)) {
          queueStates.set(configId, signal(queueState(configId)));
        }
        queueStates.get(configId)!.update((state) => ({ ...state, loading: true }));
        return () => {
          stoppedQueueWatchers.push(configId);
          queueStates.get(configId)?.update((state) => ({ ...state, loading: false }));
        };
      }),
      refreshQueue: jasmine.createSpy('refreshQueue').and.returnValue(of(null))
    };
    preferences = { expiryHorizonDays: signal(3) };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { userName } },
        { provide: PantryService, useValue: pantry },
        { provide: RecipeService, useValue: recipes },
        { provide: CalendarService, useValue: calendar },
        { provide: HouseholdService, useValue: household },
        { provide: AiService, useValue: ai },
        { provide: AiQueueService, useValue: aiQueue },
        { provide: DashboardPreferencesService, useValue: preferences },
        { provide: I18nService, useValue: { t: translate } }
      ]
    });
  });

  function createComponent(): DashboardComponent {
    return TestBed.runInInjectionContext(() => new DashboardComponent());
  }

  it('loads dashboard data and keeps the page available if household loading throws', () => {
    userName.and.returnValue('');
    household.loadHousehold.and.throwError('household unavailable');

    const component = createComponent();
    component.ngOnInit();

    expect(component.userName()).toBe('Chef');
    expect(pantry.loadIngredients).toHaveBeenCalled();
    expect(pantry.loadStats).toHaveBeenCalled();
    expect(pantry.loadCaducidades).toHaveBeenCalled();
    expect(recipes.loadRecipes).toHaveBeenCalled();
    expect(calendar.loadRange).toHaveBeenCalledWith(component.todayIso, component.todayIso);
    expect(household.loadHousehold).toHaveBeenCalled();
  });

  it('ensures household data after membership loading discovers a new active context', () => {
    const home = membership('home-discovered', true);
    household.ensureMemberships.and.callFake(() => {
      household.activeHouseholdId.set(home.id);
      household.contextRevision.update((revision) => revision + 1);
      household.household.set(null);
      return of([home]);
    });

    const component = createComponent();
    component.ngOnInit();

    expect(household.ensureHousehold).toHaveBeenCalled();
  });

  it('does not request AI queues before permission is known or for a non-settings member', () => {
    const home = membership('home-a', false);
    household.memberships.set([home]);
    household.activeHouseholdId.set(home.id);
    const membershipsResponse = new Subject<HouseholdMembership[]>();
    household.ensureMemberships.and.returnValue(membershipsResponse.asObservable());

    const component = createComponent();
    component.ngOnInit();

    expect(ai.loadConfigsSnapshot).not.toHaveBeenCalled();
    expect(aiQueue.watch).not.toHaveBeenCalled();
    membershipsResponse.next([home]);
    expect(ai.loadConfigsSnapshot).not.toHaveBeenCalled();
    expect(aiQueue.watch).not.toHaveBeenCalled();
    expect(component.aiQueueSectionVisible()).toBeFalse();
  });

  it('summarizes all queue statuses for personal/admin users and skips concurrency zero', () => {
    const home = membership('home-admin', true);
    const enabled = aiConfig('enabled');
    const unlimited = aiConfig('unlimited', 0);
    household.memberships.set([home]);
    household.activeHouseholdId.set(home.id);
    household.ensureMemberships.and.returnValue(of([home]));
    ai.loadConfigsSnapshot.and.returnValue(of([enabled, unlimited]));
    queueStates.set(
      enabled.id,
      signal(
        queueState(enabled.id, [
          queueJob('waiting', enabled.id, 'queued'),
          queueJob('running', enabled.id, 'running'),
          queueJob('failed', enabled.id, 'failed')
        ])
      )
    );

    const component = createComponent();
    component.ngOnInit();

    expect(ai.loadConfigsSnapshot).toHaveBeenCalledTimes(1);
    expect(aiQueue.watch).toHaveBeenCalledOnceWith(enabled.id);
    expect(aiQueue.watch).not.toHaveBeenCalledWith(unlimited.id);
    expect(component.aiQueueRows()).toEqual([
      jasmine.objectContaining({ configId: enabled.id, queued: 1, running: 1, failed: 1 })
    ]);
    expect(component.aiQueueSectionVisible()).toBeTrue();

    component.ngOnDestroy();
    expect(stoppedQueueWatchers).toEqual([enabled.id]);
  });

  it('allows a personal account to load its AI queues after an empty membership snapshot', () => {
    const config = aiConfig('personal');
    ai.loadConfigsSnapshot.and.returnValue(of([config]));
    queueStates.set(
      config.id,
      signal(queueState(config.id, [queueJob('personal-job', config.id, 'queued')]))
    );

    const component = createComponent();
    component.ngOnInit();

    expect(household.ensureMemberships).toHaveBeenCalled();
    expect(ai.loadConfigsSnapshot).toHaveBeenCalledOnceWith();
    expect(aiQueue.watch).toHaveBeenCalledOnceWith(config.id);
    expect(component.aiQueueRows()).toEqual([
      jasmine.objectContaining({ configId: config.id, queued: 1 })
    ]);

    component.ngOnDestroy();
  });

  it('hides eligible providers once their queues resolve without jobs', () => {
    const config = aiConfig('empty');
    ai.loadConfigsSnapshot.and.returnValue(of([config]));

    const component = createComponent();
    component.ngOnInit();

    expect(component.aiQueueSectionVisible()).toBeTrue();
    expect(component.aiQueueRows()).toContain(jasmine.objectContaining({ loading: true }));

    queueStates.get(config.id)!.set(queueState(config.id));

    expect(component.aiQueueRows()).toEqual([]);
    expect(component.aiQueueSectionVisible()).toBeFalse();
    component.ngOnDestroy();
  });

  it('does not treat membership failure or missing active-home selection as personal mode', () => {
    const home = membership('home-unselected', true);
    household.memberships.set([home]);
    household.activeHouseholdId.set(null);
    household.ensureMemberships.and.returnValue(of([home]));

    const unselected = createComponent();
    unselected.ngOnInit();
    expect(ai.loadConfigsSnapshot).not.toHaveBeenCalled();

    household.membershipsFailed.set(true);
    household.memberships.set([]);
    household.ensureMemberships.and.returnValue(of([]));
    const failed = createComponent();
    failed.ngOnInit();

    expect(ai.loadConfigsSnapshot).not.toHaveBeenCalled();
    expect(aiQueue.watch).not.toHaveBeenCalled();
  });

  it('shows config-load errors with retry and lets each provider queue retry independently', () => {
    const first = aiConfig('first');
    const second = aiConfig('second');
    ai.loadConfigsSnapshot.and.returnValues(of(null), of([first, second]));

    const component = createComponent();
    component.ngOnInit();

    expect(component.aiQueueConfigError()).toBeTrue();
    expect(component.aiQueueSectionVisible()).toBeTrue();
    component.retryAiQueueSummary();
    expect(ai.loadConfigsSnapshot).toHaveBeenCalledTimes(2);
    expect(aiQueue.watch).toHaveBeenCalledTimes(2);

    component.aiQueueRows();
    queueStates.get(second.id)!.set(queueState(second.id, [], { loadError: true }));
    expect(component.aiQueueRows()).toContain(
      jasmine.objectContaining({ configId: first.id, loading: true })
    );
    expect(component.aiQueueRows()).toContain(
      jasmine.objectContaining({ configId: second.id, error: true })
    );
    component.retryAiQueueProvider(second.id);
    expect(aiQueue.refreshQueue).toHaveBeenCalledOnceWith(second.id);
  });

  it('ignores a provider list that resolves after Dashboard destruction', () => {
    const lateConfigs = new Subject<AIProviderConfig[] | null>();
    ai.loadConfigsSnapshot.and.returnValue(lateConfigs.asObservable());

    const component = createComponent();
    component.ngOnInit();
    expect(lateConfigs.observers).toHaveSize(1);

    component.ngOnDestroy();
    lateConfigs.next([aiConfig('late')]);

    expect(lateConfigs.observers).toHaveSize(0);
    expect(aiQueue.watch).not.toHaveBeenCalled();
  });

  it('drops stale provider responses immediately when the active home changes', () => {
    const oldHome = membership('home-before-switch', true);
    const newHome = membership('home-after-switch', false);
    const lateConfigs = new Subject<AIProviderConfig[] | null>();
    household.memberships.set([oldHome]);
    household.activeHouseholdId.set(oldHome.id);
    ai.loadConfigsSnapshot.and.returnValue(lateConfigs.asObservable());

    const component = createComponent();
    component.ngOnInit();
    expect(lateConfigs.observers).toHaveSize(1);

    household.memberships.set([newHome]);
    household.activeHouseholdId.set(newHome.id);
    household.contextRevision.set(1);
    TestBed.flushEffects();

    expect(lateConfigs.observers).toHaveSize(0);
    lateConfigs.next([aiConfig('old-home-config')]);
    expect(ai.loadConfigsSnapshot).toHaveBeenCalledTimes(1);
    expect(aiQueue.watch).not.toHaveBeenCalled();
    expect(component.aiQueueRows()).toEqual([]);

    component.ngOnDestroy();
  });

  it('loads a seven-local-date meal preview without changing the shared calendar range', () => {
    calendar.range.set({ start: '2026-10-01', end: '2026-10-31' });
    const component = createComponent();
    component.ngOnInit();

    const today = localIsoDate(new Date());
    expect(calendar.getMealsForRange).toHaveBeenCalledOnceWith(
      today,
      localIsoDateOffset(new Date(), 6)
    );
    expect(calendar.range()).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('exposes next-meal load errors and retries the auxiliary read', () => {
    const now = new Date();
    calendar.getMealsForRange.and.returnValues(
      throwError(() => new Error('offline')),
      of([plannedMeal('tomorrow', localIsoDateOffset(now, 1))])
    );
    const component = createComponent();
    component.ngOnInit();

    expect(component.nextMealLoading()).toBeFalse();
    expect(component.nextMealError()).toBeTrue();

    component.retryNextMeal();

    expect(component.nextMealError()).toBeFalse();
    expect(component.nextMealLoading()).toBeFalse();
    expect(component.nextPlannedMeal()?.id).toBe('tomorrow');
    expect(calendar.getMealsForRange).toHaveBeenCalledTimes(2);
  });

  it('cancels stale and destroyed next-meal requests', () => {
    const staleResponse = new Subject<CalendarMeal[]>();
    const currentResponse = new Subject<CalendarMeal[]>();
    calendar.getMealsForRange.and.returnValues(
      staleResponse.asObservable(),
      currentResponse.asObservable()
    );
    const component = createComponent();
    component.ngOnInit();

    component.retryNextMeal();
    expect(staleResponse.observers).toHaveSize(0);
    staleResponse.next([plannedMeal('stale', localIsoDateOffset(new Date(), 1))]);
    currentResponse.next([plannedMeal('current', localIsoDateOffset(new Date(), 1))]);
    expect(component.nextPlannedMeal()?.id).toBe('current');

    component.ngOnDestroy();

    expect(currentResponse.observers).toHaveSize(0);
  });

  it('filters expiry rows using the preference and labels expired, today and upcoming dates', () => {
    pantry.caducidades.set([
      expiryRow('Expired', -1),
      expiryRow('Today', 0),
      expiryRow('At horizon', 3),
      expiryRow('Unknown', null),
      expiryRow('Outside horizon', 4)
    ]);
    const component = createComponent();

    expect(component.expiringItems().map((row) => row.name)).toEqual([
      'Expired',
      'Today',
      'At horizon'
    ]);
    expect(component.expiryStatus(-1)).toBe('dashboard.expiryStatusExpired');
    expect(component.expiryStatus(0)).toBe('dashboard.expiryStatusToday');
    expect(component.expiryStatus(3)).toBe('In 3 days');
    expect(component.expiryStatus(null)).toBe('');
  });

  it('retries expiry and today-meal loading on demand', () => {
    const component = createComponent();

    component.retryExpiries();
    component.retryTodayMeals();

    expect(pantry.loadCaducidades).toHaveBeenCalledOnceWith();
    expect(calendar.loadRange).toHaveBeenCalledOnceWith(
      component.todayIso,
      component.todayIso,
      true
    );
  });

  it('computes summary and recipe preview data and maps meal/difficulty labels', () => {
    recipes.recipes.set(
      Array.from({ length: 7 }, (_, index) => ({
        id: String(index),
        name: `Recipe ${index}`,
        totalTime: index * 10,
        difficulty: 'easy',
        image: null
      }))
    );
    calendar.range.set({ start: createComponent().todayIso, end: createComponent().todayIso });
    const component = createComponent();

    expect(component.quickStats().map((stat) => stat.value)).toEqual([4, 9, 1, 0]);
    expect(component.suggestedRecipes()).toHaveSize(6);
    expect(component.suggestedRecipes()[0].time).toBe(0);
    expect(component.calendarReady()).toBeTrue();
    expect(component.isLoading()).toBeFalse();
    expect(component.mealTypeLabel('breakfast')).toBe('meal.breakfast');
    expect(component.getDifficultyVariant('easy')).toBe('success');
    expect(component.getDifficultyVariant('difícil')).toBe('error');
    expect(component.getDifficultyVariant('medium')).toBe('warning');
    expect(component.getDifficultyVariant('')).toBe('warning');
  });
});
