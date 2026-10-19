import type { TranslationKey } from '../../core/i18n';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { ToastService } from '../../core/services/toast.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { ChipSelectComponent } from '../../shared/components/ui/chip-select/chip-select.component';
import { HomeProfilePickerComponent } from '../../shared/components/ui/home-profile-picker/home-profile-picker.component';
import { DEFAULT_HOME_PROFILE, HomeProfile, toHomeProfile } from '../../shared/models/home-profile';
import {
  COMMON_ALLERGENS,
  COMMON_DISLIKES,
  COMMON_LIKES,
  GOAL_OPTIONS,
  TasteGoal,
  TasteProfile,
  emptyTasteProfile,
  normalizeTasteProfile,
  toggleTasteGoal
} from '../../shared/models/taste-profile';
import { MealTimes, mealTimesPatch, resolveMealTimes } from '../../core/meal-times';
import { MealHoursComponent } from '../../shared/components/ui/meal-hours/meal-hours.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import {
  isLastIndex,
  nextIndex,
  ONBOARDING_STEPS,
  OnboardingStep,
  stepLabel,
  tourStatus
} from '../../core/onboarding-steps';
import { I18nService } from '../../core/services/i18n.service';
import { PageContainerComponent } from '../../shared/components/page-container/page-container.component';

/**
 * Configuración inicial, nada más registrarse: alergias, gustos, objetivo y
 * horarios. Todo es opcional y se puede saltar; los utensilios se gestionan en
 * Despensa, su única fuente de verdad.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    ButtonComponent,
    ChipSelectComponent,
    MealHoursComponent,
    HomeProfilePickerComponent,
    IconComponent,
    PageContainerComponent
  ],
  template: `
    <app-page-container [bounded]="true">
      <div class="onboarding">
        <div class="onboarding__card" (keydown)="onCardKeydown($event)">
          <header class="onboarding__header">
            <span class="onboarding__logo">
              <app-icon name="home" [size]="40" [label]="null" />
            </span>
            <h1 class="onboarding__title">{{ 'onboarding.configura_tu_hogaria' | t }}</h1>
            <p class="onboarding__subtitle">
              {{ 'onboarding.preguntas_cortas' | t: { n: steps.length } }}
            </p>
          </header>

          <div class="onboarding__progress">
            <span class="onboarding__step-label" data-test="onboarding-step-label">
              {{ stepLabel() }}
            </span>
            <span class="onboarding__bar" aria-hidden="true">
              <span class="onboarding__bar-fill" [style.width.%]="progress()"></span>
            </span>
            <button type="button" class="onboarding__skip" (click)="skip()">
              {{ 'onboarding.saltar_por_ahora' | t }}
            </button>
          </div>

          <section class="onboarding__step" [ngSwitch]="steps[stepIndex()]">
            <!-- 1 · Alergias e intolerancias -->
            <ng-container *ngSwitchCase="'profile'">
              <h2 class="onboarding__step-title">{{ 'preferences.tu_perfil' | t }}</h2>
              <p class="onboarding__step-hint">
                {{ 'onboarding.hogaria_es_tu_dia_a_dia' | t }}
              </p>
              <app-home-profile-picker
                [(profile)]="profile"
                (profileChange)="persistProgress()"
              ></app-home-profile-picker>
            </ng-container>

            <ng-container *ngSwitchCase="'allergies'">
              <h2 class="onboarding__step-title">
                {{ 'preferences.alergias_o_intolerancias' | t }}
              </h2>
              <p class="onboarding__step-hint">
                {{ 'preferences.marca_todo_lo_que' | t }}
              </p>
              <app-chip-select
                [label]="'preferences.alergias_e_intolerancias' | t"
                [options]="allergenOptions"
                [(value)]="taste.allergies"
                [customPlaceholder]="'ui.otra_alergia_o_intolerancia' | t"
                [hint]="'ui.no_esta_escribelo' | t"
              ></app-chip-select>
            </ng-container>

            <!-- 2 · Gustos -->
            <ng-container *ngSwitchCase="'tastes'">
              <h2 class="onboarding__step-title">{{ 'preferences.que_te_gusta_y' | t }}</h2>
              <p class="onboarding__step-hint">
                {{ 'preferences.sirve_para_priorizar_unos' | t }}
              </p>

              <div class="onboarding__field">
                <h3 class="onboarding__field-title">{{ 'onboarding.me_gusta' | t }}</h3>
                <app-chip-select
                  [label]="'preferences.lo_que_mas_te' | t"
                  [options]="likeOptions"
                  [(value)]="taste.likes"
                  [customPlaceholder]="'ui.otro_alimento_o_tipo_de_cocina' | t"
                ></app-chip-select>
              </div>

              <div class="onboarding__field">
                <h3 class="onboarding__field-title">{{ 'onboarding.mejor_no' | t }}</h3>
                <app-chip-select
                  [label]="'preferences.lo_que_prefieres_evitar' | t"
                  [options]="dislikeOptions"
                  [(value)]="taste.dislikes"
                  [customPlaceholder]="'ui.otro_alimento_que_no_te_gusta' | t"
                ></app-chip-select>
              </div>

              <div class="onboarding__field">
                <label class="onboarding__field-title" for="tasteNotes">
                  {{ 'onboarding.y_lo_que_quieras' | t }}
                </label>
                <textarea
                  id="tasteNotes"
                  name="tasteNotes"
                  class="onboarding__textarea"
                  rows="3"
                  maxlength="1000"
                  [placeholder]="'preferences.ej_ceno_pronto_nada' | t"
                  [(ngModel)]="taste.notes"
                ></textarea>
              </div>
            </ng-container>

            <!-- 3 · Objetivo -->
            <ng-container *ngSwitchCase="'goal'">
              <h2 class="onboarding__step-title">{{ 'preferences.cual_es_tu_objetivo' | t }}</h2>
              <p class="onboarding__step-hint">
                {{ 'onboarding.marca_el_plato_no' | t }}
              </p>

              <div class="onboarding__goals">
                <button
                  *ngFor="let goal of goalOptions"
                  type="button"
                  class="onboarding__goal"
                  [class.onboarding__goal--on]="taste.goals.includes(goal.value)"
                  [attr.aria-pressed]="taste.goals.includes(goal.value)"
                  (click)="selectGoal(goal.value)"
                >
                  <span class="onboarding__goal-icon">
                    <app-icon [name]="goal.icon" [size]="20" [label]="null" />
                  </span>
                  <span class="onboarding__goal-label">{{ goal.labelKey | t }}</span>
                  <span class="onboarding__goal-hint">{{ goal.hintKey | t }}</span>
                </button>
              </div>

              <div class="onboarding__field">
                <label class="onboarding__field-title" for="goalNotes">
                  {{
                    taste.goals.includes('custom')
                      ? ('calendar.describe_tu_objetivo' | t)
                      : ('onboarding.mas_sobre_el_objetivo' | t)
                  }}
                </label>
                <textarea
                  id="goalNotes"
                  name="goalNotes"
                  class="onboarding__textarea"
                  rows="3"
                  maxlength="500"
                  [placeholder]="
                    taste.goals.includes('custom')
                      ? ('onboarding.ej_sin_carne_los_lunes' | t)
                      : ('onboarding.ej_prioriza_proteina_en_la_cena' | t)
                  "
                  [(ngModel)]="taste.goalNotes"
                ></textarea>
              </div>
            </ng-container>

            <!-- 4 · Horarios de las comidas -->
            <ng-container *ngSwitchCase="'meals'">
              <h2 class="onboarding__step-title">{{ 'onboarding.a_que_hora_comeis' | t }}</h2>
              <p class="onboarding__step-hint">
                {{ 'onboarding.no_es_un_adorno' | t }}
              </p>

              <app-meal-hours
                idPrefix="ob-meal"
                dataTest="onboarding-meal-time"
                [times]="mealTimes"
              />

              <p class="onboarding__step-hint">
                {{ 'onboarding.cada_hora_que_cambies' | t }}
              </p>
            </ng-container>

            <!-- 5 · Utensilios -->
            <ng-container *ngSwitchCase="'kitchen'">
              <h2 class="onboarding__step-title">{{ 'onboarding.con_que_cuentas_en' | t }}</h2>
              <p class="onboarding__step-hint">
                {{ 'onboarding.utensilios_en_despensa' | t }}
              </p>

              <p class="onboarding__link-row">
                <a href="/pantry?tab=utensils" (click)="navigateToPantry($event, 'utensils')">
                  {{ 'onboarding.gestionar_utensilios' | t }}
                </a>
                <a href="/pantry?tab=ingredients" (click)="navigateToPantry($event, 'ingredients')">
                  {{ 'onboarding.revisar_la_despensa' | t }}
                </a>
              </p>
            </ng-container>
          </section>

          <footer class="onboarding__nav">
            <app-button
              variant="ghost"
              [touchTarget]="true"
              [disabled]="stepIndex() === 0 || isSaving()"
              (onClick)="back()"
            >
              {{ 'onboarding.atras' | t }}
            </app-button>
            <!-- Saltar UN paso: hasta aqui «no quiero hablar de esto ahora» cerraba el tour entero, que
                 es lo contrario de lo que la persona acaba de pedir. -->
            <button
              type="button"
              class="onboarding__skip onboarding__skip--step"
              data-test="onboarding-skip-step"
              (click)="skipStep()"
            >
              {{ 'onboarding.saltar_este_paso' | t }}
            </button>
            <app-button
              *ngIf="!isLastStep()"
              variant="primary"
              [touchTarget]="true"
              (onClick)="next()"
            >
              {{ 'onboarding.siguiente' | t }}
            </app-button>
            <app-button
              *ngIf="isLastStep()"
              variant="primary"
              [touchTarget]="true"
              [loading]="isSaving()"
              (onClick)="finish()"
            >
              {{ 'onboarding.guardar_y_empezar' | t }}
            </app-button>
          </footer>
        </div>

        <p class="onboarding__footnote">
          {{ 'onboarding.se_guarda_en_tu' | t }}
        </p>
      </div>
    </app-page-container>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: var(--bg-secondary);
        padding-block: var(--space-6);
      }
      .onboarding {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .onboarding__card {
        width: 100%;
        max-width: 720px;
        margin-inline: auto;
        background: var(--bg-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        padding: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }
      .onboarding__header {
        text-align: center;
      }
      .onboarding__logo {
        display: block;
        margin-bottom: var(--space-2);
        color: var(--primary);
      }
      .onboarding__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
        margin: 0 0 var(--space-2);
      }
      .onboarding__subtitle {
        margin: 0 auto;
        max-width: 46ch;
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .onboarding__progress {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex-wrap: wrap;
      }
      .onboarding__step-label {
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        white-space: nowrap;
      }
      .onboarding__bar {
        flex: 1 1 120px;
        min-width: 80px;
        height: 6px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        overflow: hidden;
      }
      .onboarding__bar-fill {
        display: block;
        height: 100%;
        background: var(--primary);
        border-radius: var(--radius-full);
        transition: width var(--duration-300) var(--ease-out);
      }
      /* «Saltar por ahora» y «Saltar este paso» siguen siendo la accion secundaria —de ahi el color
         apagado—, pero un texto subrayado no tiene forma de nada: la ronda 19 pidio que todo lo pulsable
         lo pareciera, y esto era lo ultimo de la app que se hacia el distraido. Pastilla con borde suave,
         y el mismo hover que el resto de los contornos. */
      .onboarding__skip {
        background: transparent;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        cursor: pointer;
        font-family: var(--font-sans);
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        padding: var(--space-1) var(--space-3);
        min-height: 44px;
        transition: var(--transition-fast);
        &:hover:not(:disabled) {
          color: var(--text-primary);
          border-color: var(--border-strong);
          background: var(--bg-tertiary);
        }
      }

      /* El del pie de paso es el boton que la gente va a buscar cuando se pierde: un pelin mas de caja
         que el de la cabecera, sin subirse de color. */
      .onboarding__skip--step {
        font-size: var(--text-sm);
        padding: var(--space-2) var(--space-4);
        min-height: 44px;
      }

      .onboarding__step {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .onboarding__step-title {
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        margin: 0;
      }
      .onboarding__step-hint {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .onboarding__field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .onboarding__field-title {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
      }
      .onboarding__textarea {
        width: 100%;
        resize: vertical;
        padding: var(--space-2) var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        &:focus {
          outline: none;
          border-color: var(--primary);
        }
      }

      .onboarding__goals {
        display: grid;
        gap: var(--space-2);
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      }
      .onboarding__goal {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        text-align: left;
        padding: var(--space-3);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition: var(--transition-fast);
        font-family: var(--font-sans);
        &:hover {
          border-color: var(--border-strong);
        }
        &--on {
          border-color: var(--primary);
          background: var(--primary-subtle);
        }
      }
      .onboarding__goal-icon {
        display: inline-flex;
        align-items: center;
        color: var(--primary);
      }
      .onboarding__goal-label {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .onboarding__goal-hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .onboarding__link-row {
        display: flex;
        gap: var(--space-4);
        flex-wrap: wrap;
        margin: 0;
        font-size: var(--text-sm);
        a {
          display: inline-flex;
          align-items: center;
          min-height: 44px;
          color: var(--primary);
          text-decoration: none;
          &:hover {
            text-decoration: underline;
          }
          &:focus-visible {
            outline: 2px solid var(--primary);
            outline-offset: 2px;
          }
        }
      }

      .onboarding__nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .onboarding__footnote {
        margin: 0;
        text-align: center;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }

      @media (max-width: 560px) {
        .onboarding__card {
          padding: var(--space-4);
        }
        .onboarding__goals {
          grid-template-columns: 1fr;
        }
        .onboarding__nav {
          flex-wrap: wrap;
        }
      }
    `
  ]
})
export class OnboardingComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly tasteService = inject(TasteProfileService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  /** Los pasos, en el orden en que se preguntan (ver `core/onboarding-steps.ts`). */
  readonly steps = ONBOARDING_STEPS;
  readonly stepIndex = signal(0);
  readonly isSaving = signal(false);
  private progressSavePending = false;
  /**
   * Pasos saltados uno a uno. No cambian lo que se guarda —lo que haya en el formulario se guarda
   * igual—; cambian lo que se *dice* del paso (la cabecera lo anuncia «sin responder») y si el tour
   * entero acaba siendo un salto, ese es el estado que se registra.
   */
  readonly skippedSteps = signal<ReadonlySet<OnboardingStep>>(new Set<OnboardingStep>());
  /** Evita persistir por defecto antes de que la carga inicial haya terminado. */
  private loaded = false;

  /** Copia local: nada se guarda hasta «Guardar y empezar» o «Saltar». */
  taste: TasteProfile = emptyTasteProfile();
  profile: HomeProfile = DEFAULT_HOME_PROFILE;

  readonly allergenOptions = COMMON_ALLERGENS;
  readonly likeOptions = COMMON_LIKES;
  readonly dislikeOptions = COMMON_DISLIKES;
  readonly goalOptions = GOAL_OPTIONS;

  /** «Paso 4 de 6 · Horarios · sin responder»: numero y titulo derivados de la misma lista. */
  readonly stepLabel = computed(() => {
    const partes = stepLabel(
      this.stepIndex(),
      this.steps,
      this.skippedSteps().has(this.steps[this.stepIndex()])
    );
    // El numero y el titulo los arma aqui, con el diccionario a mano; el modulo de pasos solo sabe de
    // listas y claves, y asi la cabecera cambia de idioma con la app (HOGARIA-SPEC 12t-i18n).
    return (
      this.i18n.t('onboarding.paso_de', {
        n: partes.numero,
        total: partes.total,
        titulo: this.i18n.t(partes.tituloKey)
      }) + (partes.skipped ? this.i18n.t('onboarding.sin_responder') : '')
    );
  });

  readonly progress = computed(() => ((this.stepIndex() + 1) / this.steps.length) * 100);
  readonly isLastStep = computed(() => isLastIndex(this.stepIndex(), this.steps.length));

  /** Copia editable: viaja al backend con el resto del perfil, y solo lo que ha cambiado. */
  mealTimes: MealTimes = resolveMealTimes(null);
  private savedMealTimes: MealTimes = resolveMealTimes(null);

  ngOnInit(): void {
    // Si ya lo hizo (o lo saltó), no se le vuelve a preguntar: entra y edita.
    this.tasteService.load().subscribe({
      next: (data) => {
        this.taste = normalizeTasteProfile(data.taste);
        this.profile = toHomeProfile(data.profile);
        this.applyMealTimes(this.tasteService.mealTimes());
        this.loaded = true;
      },
      error: () => {
        this.taste = emptyTasteProfile();
        this.profile = DEFAULT_HOME_PROFILE;
        // Sin respuesta no hay horas guardadas que mostrar: se enseñan las de la app, y si el usuario
        // no las toca, el parche que se manda es vacio (nada de fijar un defecto por defecto).
        this.applyMealTimes(resolveMealTimes(null));
        this.loaded = true;
      }
    });
  }

  private applyMealTimes(times: MealTimes): void {
    this.mealTimes = { ...times };
    this.savedMealTimes = { ...times };
  }

  selectGoal(goal: TasteGoal): void {
    this.taste.goals = toggleTasteGoal(this.taste.goals, goal);
  }

  /**
   * Guarda las respuestas del tour antes de salir hacia Pantry. Si falla la red,
   * la navegación se cancela y la copia local sigue en pantalla para reintentar.
   */
  navigateToPantry(event: MouseEvent, tab: 'utensils' | 'ingredients'): void {
    event.preventDefault();
    if (!this.loaded || this.progressSavePending) return;

    this.progressSavePending = true;
    this.saveProgress(
      () => {
        this.progressSavePending = false;
        void this.router.navigate(['/pantry'], { queryParams: { tab } });
      },
      () => (this.progressSavePending = false)
    );
  }

  /** El perfil se guarda progresivamente, igual que en la versión anterior del tour. */
  persistProgress(): void {
    this.saveProgress();
  }

  private saveProgress(onSaved?: () => void, onFailed?: () => void): void {
    if (!this.loaded) return;
    this.tasteService.save(this.taste, undefined, this.profile, this.mealTimesPatch()).subscribe({
      next: () => onSaved?.(),
      error: () => {
        onFailed?.();
        this.toastService.error(
          this.i18n.t('ui.error'),
          this.i18n.t('onboarding.no_se_pudo_guardar_progreso')
        );
      }
    });
  }

  /** Solo las horas que han cambiado: verlas en pantalla no es editarlas. */
  private mealTimesPatch() {
    return mealTimesPatch(this.mealTimes, this.savedMealTimes);
  }

  /**
   * Esc salta el paso y Enter lo cierra, que es lo que la mano ya espera de un asistente. Dos excepciones
   * que son peores que el atajo si no estan: un textarea necesita el Enter para partir la nota, y con el
   * picker nativo de una hora abierto, Esc tiene que cerrar el picker, no el paso.
   */
  onCardKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = (target?.tagName ?? '').toUpperCase();
    const inputType = (target as HTMLInputElement | null)?.type;

    if (event.key === 'Enter') {
      if (
        tag === 'TEXTAREA' ||
        tag === 'BUTTON' ||
        tag === 'A' ||
        target?.getAttribute('role') === 'button' ||
        target?.getAttribute('role') === 'link'
      )
        return;
      // Y no acaba el tour: terminar y guardar tiene que ser un boton, no una tecla que se pulsa sola.
      event.preventDefault();
      this.next();
      return;
    }

    if (event.key === 'Escape') {
      if (inputType === 'time' || inputType === 'date') return;
      event.preventDefault();
      this.skipStep();
    }
  }

  next(): void {
    const target = nextIndex(this.stepIndex(), this.steps.length);
    this.stepIndex.set(target);
  }

  /**
   * Saltar SOLO este paso. Se guarda lo que hubiera escrito hasta aqui (la misma regla que
   * `persistProgress`), se marca el paso como sin responder y se avanza: en el ultimo paso, avanzar
   * significa quedarse y pulsar «Guardar y empezar», que es el unico boton que cierra el tour.
   */
  skipStep(): void {
    const step = this.steps[this.stepIndex()];
    this.skippedSteps.update((skipped) => new Set(skipped).add(step));
    this.persistProgress();
    this.next();
  }

  back(): void {
    if (this.stepIndex() === 0) return;
    this.stepIndex.update((step) => step - 1);
  }

  finish(): void {
    const status = tourStatus([...this.skippedSteps()]);
    // Las dos frases van en clave; `save` las traduce al pintarlas, que es donde vive `i18n` (12t-i18n).
    this.save(
      status,
      status === 'done' ? 'onboarding.listo' : 'onboarding.guardado',
      status === 'done' ? 'onboarding.perfil_y_preferencias' : 'onboarding.te_lo_preguntamos'
    );
  }

  /** Se salta, pero lo que haya escrito se guarda igualmente. */
  skip(): void {
    this.save('skipped', 'onboarding.guardado', 'onboarding.puedes_completarlo');
  }

  private save(status: 'done' | 'skipped', title: TranslationKey, body: TranslationKey): void {
    this.isSaving.set(true);

    this.tasteService.save(this.taste, status, this.profile, this.mealTimesPatch()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.toastService.success(this.i18n.t(title), this.i18n.t(body));
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.isSaving.set(false);
        this.toastService.error(
          this.i18n.t('ui.error'),
          this.i18n.t('ai_config.no_se_pudo_guardar')
        );
      }
    });
  }
}
