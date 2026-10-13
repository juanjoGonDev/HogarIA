import { effect, Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  HouseholdEvent,
  HouseholdEventKind,
  CalendarMeal,
  Meal,
  MealType,
  NutritionalGoals,
  WeeklyCalendar
} from '../../shared/models/calendar.model';
import { I18nService } from '../../core/services/i18n.service';
import { HouseholdService } from './household.service';
import { LatestRequest } from '../utils/latest-request';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import type { AIGuestPreferences } from '../../shared/models/ai-config.model';

/** Fila cruda de `meals` tal y como la devuelve la API (snake_case). */
interface MealRow {
  id: string;
  date: string;
  meal_type: MealType;
  recipe_id: string | null;
  recipe_name: string | null;
  recipe_calories: number | null;
  custom_meal: string | null;
  time: string | null;
  servings: number | null;
  notes: string | null;
  completed: number | boolean | null;
  isShared?: number | boolean;
  participantIds?: string[];
}

interface RangeResponse {
  data: {
    startDate: string;
    endDate: string;
    goals: NutritionalGoals | null;
    meals: MealRow[];
  } | null;
}

export interface CalendarRange {
  start: string;
  end: string;
}

const DEFAULT_DAILY_CALORIES = 2000;

function toMeal(row: MealRow): CalendarMeal {
  return {
    id: row.id,
    date: row.date,
    mealType: row.meal_type,
    title: row.recipe_name?.trim() || row.custom_meal?.trim() || 'Comida',
    recipeId: row.recipe_id ?? null,
    customMeal: row.custom_meal ?? null,
    time: row.time ?? null,
    servings: row.servings ?? 1,
    notes: row.notes ?? null,
    completed: row.completed === 1 || row.completed === true,
    calories: typeof row.recipe_calories === 'number' ? row.recipe_calories : null,
    isShared: row.isShared === 1 || row.isShared === true,
    participantIds: Array.isArray(row.participantIds) ? row.participantIds : []
  };
}

/**
 * Datos del calendario.
 *
 * La unidad de trabajo es el **rango visible** (día / semana / mes), no «la
 * semana actual»: la API devuelve las comidas de ese rango y aquí se indexan por
 * fecha para que cada celda pinte lo suyo sin buscar en bucle. Las mutaciones
 * vuelven a pedir el rango —la fuente de verdad es el servidor—, salvo el
 * marcar como hecho, que se pinta al instante y se confirma después.
 */
@Injectable({
  providedIn: 'root'
})
export class CalendarService {
  private readonly i18n = inject(I18nService);
  private readonly householdService = inject(HouseholdService);
  private readonly apiUrl = `${environment.apiUrl}/calendar`;
  private http = inject(HttpClient);
  private observedHouseholdRevision = this.householdService.contextRevision();
  private observedHouseholdId = this.householdService.activeHouseholdId();
  private householdContextNeedsReload = false;

  private mealsSignal = signal<CalendarMeal[]>([]);
  private goalsSignal = signal<NutritionalGoals | null>(null);
  private rangeSignal = signal<CalendarRange | null>(null);
  private retainedRange: CalendarRange | null = null;
  private isLoadingSignal = signal(false);
  private errorSignal = signal<string | null>(null);
  private lastRequested = '';
  private readonly rangeLoadRequests = new LatestRequest();

  constructor() {
    effect(() => {
      const revision = this.householdService.contextRevision();
      const householdId = this.householdService.activeHouseholdId();
      const switching = this.householdService.switchingHousehold();

      if (revision !== this.observedHouseholdRevision || householdId !== this.observedHouseholdId) {
        this.observedHouseholdRevision = revision;
        this.observedHouseholdId = householdId;
        this.householdContextNeedsReload = true;
        this.clearHouseholdScopedData();
      }

      if (!this.householdContextNeedsReload || switching) return;

      this.householdContextNeedsReload = false;
      const range = this.retainedRange ?? this.rangeSignal();
      if (!range) return;

      this.loadRange(range.start, range.end, true);
      this.loadHouseholdEvents(range.start, range.end, true);
    });
  }

  /** @deprecated El dashboard sigue leyendo el calendario «de la semana actual». */
  private calendarSignal = signal<WeeklyCalendar | null>(null);

  readonly meals = this.mealsSignal.asReadonly();
  readonly range = this.rangeSignal.asReadonly();
  readonly goals = this.goalsSignal.asReadonly();
  readonly isLoading = this.isLoadingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly calendar = this.calendarSignal.asReadonly();

  /**
   * Immediately drops data from the previous active home and invalidates its in-flight reads.
   * Keep the visible date range so it can be fetched again once HouseholdService finishes switching.
   */
  private clearHouseholdScopedData(): void {
    this.rangeLoadRequests.begin();
    this.eventRangeRequests.begin();
    this.lastRequested = '';
    this.eventsWindow = null;
    this.mealsSignal.set([]);
    this.goalsSignal.set(null);
    this.errorSignal.set(null);
    this.isLoadingSignal.set(false);
    this.householdEvents.set([]);
    this.eventsError.set(null);
    this.eventsLoading.set(false);
    this.calendarSignal.set(null);
  }

  /** Calorías objetivo del periodo visible (las de la semana que se mira). */
  readonly targetCalories = computed(
    () => this.goalsSignal()?.dailyCalories || DEFAULT_DAILY_CALORIES
  );
  readonly goalType = computed(
    () => this.goalsSignal()?.types?.[0] ?? this.goalsSignal()?.type ?? null
  );

  /** Fecha -> comidas. Una Map para que la rejilla pinte en O(1) por celda. */
  readonly mealsByDate = computed(() => {
    const byDate = new Map<string, CalendarMeal[]>();
    for (const meal of this.mealsSignal()) {
      const list = byDate.get(meal.date);
      if (list) list.push(meal);
      else byDate.set(meal.date, [meal]);
    }
    return byDate;
  });

  loadRange(start: string, end: string, force = false): void {
    const key = `${start}|${end}`;
    if (!force && key === this.lastRequested) return;
    const requestId = this.rangeLoadRequests.begin();
    this.lastRequested = key;
    this.retainedRange = { start, end };
    this.isLoadingSignal.set(true);

    const params = new HttpParams().set('startDate', start).set('endDate', end);
    this.http
      .get<RangeResponse>(`${this.apiUrl}/range`, {
        params,
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(
        tap((response) => {
          if (!this.rangeLoadRequests.isCurrent(requestId)) return;
          this.lastRequested = key;
          this.rangeSignal.set({ start, end });
          this.mealsSignal.set((response.data?.meals ?? []).map(toMeal));
          this.goalsSignal.set(response.data?.goals ?? null);
          this.errorSignal.set(null);
          this.isLoadingSignal.set(false);
        }),
        catchError(() => {
          // Se deja el dato anterior en pantalla: mejor un calendario algo
          // desactualizado que uno vacío por un pico de la API.
          if (this.rangeLoadRequests.isCurrent(requestId)) {
            this.lastRequested = '';
            this.errorSignal.set(this.i18n.t('ui.no_se_han_podido'));
            this.isLoadingSignal.set(false);
          }
          return of(null);
        })
      )
      .subscribe();
  }

  /** Lee un rango auxiliar sin mutar la vista actualmente abierta (p. ej. semana desde vista mes/día). */
  getMealsForRange(start: string, end: string): Observable<CalendarMeal[]> {
    const params = new HttpParams().set('startDate', start).set('endDate', end);
    return this.http
      .get<RangeResponse>(`${this.apiUrl}/range`, {
        params,
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(map((response) => (response.data?.meals ?? []).map(toMeal)));
  }

  /** Vuelve a pedir el rango visible (después de guardar, borrar, generar…). */
  refresh(): void {
    const range = this.rangeSignal();
    if (range) this.loadRange(range.start, range.end, true);
  }

  addMeal(meal: {
    date: string;
    mealType: MealType;
    recipeId?: string;
    customMeal?: string;
    time?: string;
    servings?: number;
    notes?: string;
  }): Observable<Meal | null> {
    return this.http.post<any>(`${this.apiUrl}/meals`, meal).pipe(
      tap(() => this.refresh()),
      catchError(() => of(null))
    );
  }

  updateMeal(id: string, data: Partial<Meal>): Observable<Meal | null> {
    return this.http.patch<any>(`${this.apiUrl}/meals/${id}`, data).pipe(
      tap(() => this.refresh()),
      catchError(() => of(null))
    );
  }

  /** Confirma una sustitución múltiple en una única transacción del servidor. */
  replaceSelectedMeals(
    replacements: Array<{ id: string; customMeal: string }>
  ): Observable<boolean> {
    return this.http
      .patch<{ success?: boolean }>(`${this.apiUrl}/meals/bulk/replace-selected`, { replacements })
      .pipe(
        map((response) => response?.success === true),
        tap((applied) => {
          if (applied) this.refresh();
        }),
        catchError(() => of(false))
      );
  }

  deleteMeal(id: string): Observable<boolean> {
    // Fuera de la lista antes de responder: la rejilla se vacía al instante.
    this.mealsSignal.update((meals) => meals.filter((meal) => meal.id !== id));
    return this.http
      .delete<any>(`${this.apiUrl}/meals/${id}`, {
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(
        map(() => true),
        tap(() => this.refresh()),
        catchError(() => {
          this.refresh();
          return of(false);
        })
      );
  }

  /** Optimista: se marca y se confirma con el servidor; si falla, se revierte. */
  toggleComplete(meal: CalendarMeal): void {
    const next = !meal.completed;
    this.patchMealLocally(meal.id, { completed: next });
    this.http
      .patch<any>(`${this.apiUrl}/meals/${meal.id}`, { completed: next })
      .pipe(
        catchError(() => {
          this.patchMealLocally(meal.id, { completed: meal.completed });
          return of(null);
        })
      )
      .subscribe();
  }

  private patchMealLocally(id: string, patch: Partial<CalendarMeal>): void {
    this.mealsSignal.update((meals) =>
      meals.map((meal) => (meal.id === id ? { ...meal, ...patch } : meal))
    );
  }

  /**
   * `weekStart` dice a qué semana applies los objetivos (la que se está viendo);
   * sin él el servidor usa la actual.
   */
  updateGoals(goals: NutritionalGoals, weekStart?: string): Observable<unknown> {
    return this.http
      .patch<unknown>(
        `${this.apiUrl}/goals`,
        { ...goals, weekStart },
        {
          context: new HttpContext().set(SILENT_TOAST, true)
        }
      )
      .pipe(tap(() => this.refresh()));
  }

  generateWithAi(params: {
    startDate: string;
    endDate: string;
    goals: {
      types?: string[];
      type?: string;
      caloriesTarget?: number;
      customInstructions?: string;
    };
    /**
     * Que comidas se piden. Vacio = el dia entero (el mismo acuerdo que aplica el server en
     * `resolveMealTypes`): «no he marcado nada» no puede significar «no quiero plan».
     */
    mealTypes?: string[];
    householdMemberIds?: string[];
    guests?: AIGuestPreferences[];
  }): Observable<{ days: unknown[]; saved?: { created: number; skipped: number } } | null> {
    return this.http
      .post<any>(`${environment.apiUrl}/ai/plan-week`, params)
      .pipe(map((response) => response?.data ?? null));
  }

  /* ─── Compatibilidad con lo que ya existía (dashboard) ─── */

  /** @deprecated Usa `loadRange`; se mantiene porque el dashboard lo llama. */
  loadCalendar(): void {
    this.http
      .get<any>(this.apiUrl)
      .pipe(
        tap((response) => this.calendarSignal.set(response.data)),
        catchError(() => of(null))
      )
      .subscribe();
  }

  /** @deprecated Sin llamadas desde la app; persiste la semana que se le pida. */
  createCalendar(weekStart: string, goals?: NutritionalGoals): Observable<WeeklyCalendar | null> {
    return this.http.post<{ data: WeeklyCalendar }>(this.apiUrl, { weekStart, goals }).pipe(
      map((response) => response.data),
      tap((calendar) => this.calendarSignal.set(calendar)),
      catchError(() => of(null))
    );
  }

  // ----------------------------------------------- eventos de la casa (8f)
  //
  // Viven en el MISMO calendario que las comidas pero en otra lectura: el plan se
  // regenera y los eventos de casa no. Filtrar por capas es local (`visibleKinds`) para que
  // encender/apagar «Citas» no sea una peticion cada vez.
  readonly householdEvents = signal<HouseholdEvent[]>([]);
  readonly visibleKinds = signal<HouseholdEventKind[]>([
    'shopping',
    'home',
    'appointment',
    'personal',
    'other'
  ]);
  readonly eventsLoading = signal(false);
  readonly eventsError = signal<string | null>(null);
  readonly creatingEvent = signal(false);
  private eventsWindow: string | null = null;
  private readonly eventRangeRequests = new LatestRequest();

  /**
   * Una peticion por ventana, no una por re-computacion.
   *
   * El `force` existe para `reload()` (que es literalmente "vuelve a pedir lo mismo"). Sin el
   * guardado por ventana, cualquier senal que se escriba al cargar y se lea al pintar vuelve a
   * disparar el efecto de carga, y eso es un bucle de peticiones que termina en un 429 del
   * limitador —no en un calendario al día.
   */
  loadHouseholdEvents(from: string, to: string, force = false): void {
    const window = `${from}|${to}`;
    if (!force && this.eventsWindow === window) return;
    const requestId = this.eventRangeRequests.begin();
    this.eventsWindow = window;
    this.eventsLoading.set(true);
    this.eventsError.set(null);
    const params = new HttpParams().set('from', from).set('to', to).set('limit', '500');
    this.http
      .get<{ data: HouseholdEvent[] }>(`${this.apiUrl}/events`, { params })
      .pipe(
        map((response) => response.data ?? []),
        catchError((error) => {
          if (this.eventRangeRequests.isCurrent(requestId)) {
            this.eventsError.set(this.readError(error));
            // Una ventana que fallo se olvida: si no, reintentar sin cambiar de rango
            // nunca volveria a pedir nada.
            this.eventsWindow = null;
          }
          return of([] as HouseholdEvent[]);
        }),
        tap(() => {
          if (this.eventRangeRequests.isCurrent(requestId)) this.eventsLoading.set(false);
        })
      )
      .subscribe((events) => {
        if (this.eventRangeRequests.isCurrent(requestId)) this.householdEvents.set(events);
      });
  }

  /** Se recarga el rango actual: es lo que quiere el usuario después de crear o borrar. */
  refreshHouseholdEvents(): void {
    const range = this.rangeSignal();
    if (range) this.loadHouseholdEvents(range.start, range.end, true);
  }

  toggleKind(kind: HouseholdEventKind): void {
    this.visibleKinds.update((kinds) =>
      kinds.includes(kind) ? kinds.filter((entry) => entry !== kind) : [...kinds, kind]
    );
  }

  visibleEventsOn(date: string): HouseholdEvent[] {
    const kinds = this.visibleKinds();
    return this.householdEvents()
      .filter((event) => event.date === date && kinds.includes(event.kind))
      .sort((a, b) => {
        // Todo el día arriba, y después por hora: es el orden en que se lee un día, y el
        // que hace que una franja de 8 h no se cuele entre dos citas de la tarde.
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startTime ?? '').localeCompare(b.startTime ?? '');
      });
  }

  saveHouseholdEvent(input: Record<string, unknown>, id?: string): Promise<HouseholdEvent | null> {
    this.creatingEvent.set(true);
    const call$ = id
      ? this.http.patch<{ data: HouseholdEvent }>(`${this.apiUrl}/events/${id}`, input)
      : this.http.post<{ data: HouseholdEvent }>(`${this.apiUrl}/events`, input);
    return new Promise<HouseholdEvent | null>((resolve) => {
      call$
        .pipe(
          map((response) => response.data),
          catchError((error) => {
            this.eventsError.set(this.readError(error));
            return of(null);
          })
        )
        .subscribe({
          next: (event) => {
            this.creatingEvent.set(false);
            if (event) this.upsertLocal(event);
            resolve(event);
          },
          error: () => {
            this.creatingEvent.set(false);
            resolve(null);
          },
          complete: () => this.creatingEvent.set(false)
        });
    });
  }

  removeHouseholdEvent(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.http
        .delete(`${this.apiUrl}/events/${id}`)
        .pipe(
          map(() => true),
          catchError((error) => {
            this.eventsError.set(this.readError(error));
            return of(false);
          })
        )
        .subscribe({
          next: (succeeded) => {
            if (succeeded) {
              this.householdEvents.update((events) => events.filter((event) => event.id !== id));
            }
            resolve(succeeded);
          },
          error: () => resolve(false)
        });
    });
  }

  /**
   * «Solo este dia no» (HOGARIA-SPEC 12t-R). NO es un DELETE del evento: anota la excepcion en la serie,
   * y los demas dias siguen ahi. Se vuelve a leer la ventana en vez de retocar la lista a mano porque
   * quien sabe que dias ocupa una serie es la expansion del servidor.
   */
  skipHouseholdOccurrence(id: string, date: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.http
        .delete(`${this.apiUrl}/events/${id}/occurrences/${date}`)
        .pipe(
          map(() => true),
          catchError((error) => {
            this.eventsError.set(this.readError(error));
            return of(false);
          })
        )
        .subscribe({
          next: (succeeded) => {
            if (succeeded) this.refreshHouseholdEvents();
            resolve(succeeded);
          },
          error: () => resolve(false)
        });
    });
  }

  /**
   * Salirse de un evento ajeno (HOGARIA-SPEC 12o). Es un DELETE en la invitacion, no en el evento:
   * `delete` del evento daria 403 y, si no lo diera, borrariria la cena de toda la casa.
   */
  leaveHouseholdEvent(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.http
        .delete(`${this.apiUrl}/events/${id}/attendees/me`)
        .pipe(
          map(() => true),
          catchError((error) => {
            this.eventsError.set(this.readError(error));
            return of(false);
          })
        )
        .subscribe({
          next: (succeeded) => {
            // Se pide la ventana otra vez en vez de retocar la lista a mano: quien decide si un evento
            // se ve o no es la regla de visibilidad del servidor, y replicarla aqui seria un segundo
            // dueño de la misma verdad (que se desincroniza el día que cambie la regla).
            if (succeeded) this.refreshHouseholdEvents();
            resolve(succeeded);
          },
          error: () => resolve(false)
        });
    });
  }

  private upsertLocal(event: HouseholdEvent): void {
    this.householdEvents.update((events) =>
      events.some((entry) => entry.id === event.id)
        ? events.map((entry) => (entry.id === event.id ? { ...entry, ...event } : entry))
        : [...events, event]
    );
  }

  private readError(error: unknown): string {
    const status = (error as { status?: number })?.status;
    // Las tres salian en espanol tal cual con la app en ingles: el codigo lo decide el servidor, pero
    // la frase que ve la persona va al diccionario, que es el unico sitio donde existen los dos idiomas.
    if (status === 403) return this.i18n.t('calendar.solo_quien_lo_escribio');
    if (status === 400) return this.i18n.t('calendar.revisa_la_fecha');
    return this.i18n.t('calendar.no_se_ha_podido_hablar');
  }
}
