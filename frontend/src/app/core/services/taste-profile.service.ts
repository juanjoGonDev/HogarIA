import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, finalize, map, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  emptyTasteProfile,
  hasTasteProfile,
  normalizeTasteProfile,
  OnboardingState,
  OnboardingStatus,
  TasteProfile,
  TasteResponse
} from '../../shared/models/taste-profile';
import { MealPlan, MealTimes, resolveMealPlan, resolveMealTimes } from '../meal-times';
import { MealType } from '../../shared/models/calendar.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import {
  DEFAULT_HOME_PROFILE,
  HomeModule,
  HomeProfile,
  toHomeProfile
} from '../../shared/models/home-profile';

/**
 * Gustos, alergias y objetivo del comensal.
 *
 * Se rellena en el onboarding y se edita en Preferencias; el estado vive aquí
 * que las dos vistas vean lo mismo sin recargar la página.
 */
@Injectable({
  providedIn: 'root'
})
export class TasteProfileService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/auth/taste`;

  readonly taste = signal<TasteProfile>(emptyTasteProfile());
  /**
   * Las horas de la casa (Desayuno 09:00, Almuerzo 14:00, Merienda 17:00, Cena 20:30 por defecto).
   *
   * Viven aqui y no en Preferencias porque las consume media app: la rejilla del calendario coloca sus
   * anclas aqui, el dialog de «+» prellena la hora con ellas y el onboarding las pregunta. En un signal
   * significa que cambiarlas en un sitio se note en los otros sin recargar la pagina.
   */
  readonly mealTimes = signal<MealTimes>(resolveMealTimes(null));
  /**
   * Que comidas se atreve a planificar la IA (12t-T).
   *
   * Vive junto a `mealTimes` y no en Preferencias por el mismo motivo: las lee el dialog de «Generar con
   * IA» del calendario para no ofrecer lo bloqueado, y lo escribe el formulario de horarios. Es una sola
   * decision partida en dos controles, y dos verdades se desincronizan.
   */
  readonly mealPlan = signal<MealPlan>(resolveMealPlan(null));
  /** Nivel de cocina y secciones de la casa que quiere llevar. */
  readonly profile = signal<HomeProfile>(DEFAULT_HOME_PROFILE);
  readonly onboarding = signal<OnboardingState>({ status: 'pending', completedAt: null });
  readonly isLoading = signal(false);
  readonly isLoaded = signal(false);

  readonly hasProfile = computed(() => hasTasteProfile(this.taste()));

  /** Carga una sola vez: lo usan las vistas que solo leen el perfil. */
  ensureLoaded(): void {
    if (this.isLoaded() || this.isLoading()) return;
    this.load().subscribe({ error: () => undefined });
  }

  load(): Observable<TasteResponse> {
    this.isLoading.set(true);

    return this.http.get<any>(this.apiUrl).pipe(
      map((response) => response.data as TasteResponse),
      tap((data) => this.apply(data)),
      finalize(() => this.isLoading.set(false))
    );
  }

  /**
   * Un solo PATCH con todo lo que la pantalla ha editado: «Guardar preferencias» no puede ser dos
   * escritos, porque a medias —si el segundo falla— deja una casa que cena a una hora en el calendario y
   * a otra en el plan.
   */
  save(
    taste: Partial<TasteProfile>,
    onboardingStatus?: OnboardingStatus,
    profile?: Partial<HomeProfile>,
    /** `null` en una comida = «quita su horario», que es como se vuelve al de la app. */
    mealTimes?: Partial<Record<MealType, string | null>>,
    /** Los permisos del planificador (12t-T): solo lo que cambio, con el mismo acuerdo de no tocar lo demas. */
    mealPlan?: Partial<Record<MealType, boolean | null>>
  ): Observable<TasteResponse> {
    this.isLoading.set(true);

    return this.http
      .patch<any>(
        this.apiUrl,
        {
          taste,
          ...(onboardingStatus ? { onboardingStatus } : {}),
          ...(profile?.cookingLevel ? { cookingLevel: profile.cookingLevel } : {}),
          ...(profile?.modules ? { modules: profile.modules } : {}),
          ...(mealTimes ? { mealTimes } : {}),
          ...(mealPlan ? { mealPlan } : {})
        },
        {
          // Preferences y onboarding traducen y conservan el error en su propio formulario.
          // El toast genérico del interceptor duplicaría esa respuesta.
          context: new HttpContext().set(SILENT_TOAST, true)
        }
      )
      .pipe(
        map((response) => response.data as TasteResponse),
        tap((data) => this.apply(data)),
        finalize(() => this.isLoading.set(false))
      );
  }

  private apply(data: TasteResponse): void {
    if (!data) return;

    this.taste.set(normalizeTasteProfile(data.taste));
    this.onboarding.set(data.onboarding ?? { status: 'pending', completedAt: null });
    this.profile.set(toHomeProfile(data.profile));
    // Se reemplaza, no se fusiona: la respuesta ya trae las cuatro (las que la casa no ha tocado salen
    // con su defecto), y una fusion dejaria intacta la hora que el usuario acaba de vaciar.
    if (data.mealTimes) this.mealTimes.set(resolveMealTimes(data.mealTimes));
    // Igual que las horas: la respuesta ya trae los cuatro permisos, asi que se reemplaza el bloque.
    if (data.mealPlan) this.mealPlan.set(resolveMealPlan(data.mealPlan));
    this.isLoaded.set(true);
  }
}
