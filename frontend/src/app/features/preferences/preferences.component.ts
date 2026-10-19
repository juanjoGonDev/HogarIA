import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import type { TranslationKey } from '../../core/i18n';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { ChipSelectComponent } from '../../shared/components/ui/chip-select/chip-select.component';
import { HomeProfilePickerComponent } from '../../shared/components/ui/home-profile-picker/home-profile-picker.component';
import {
  COOKING_LEVEL_LABEL_KEYS,
  cookingLevelWord,
  DEFAULT_HOME_PROFILE,
  HomeProfile,
  toHomeProfile
} from '../../shared/models/home-profile';
import {
  COMMON_ALLERGENS,
  COMMON_DISLIKES,
  COMMON_LIKES,
  GOAL_OPTIONS,
  normalizeTasteProfile,
  TasteProfile,
  emptyTasteProfile,
  toggleTasteGoal
} from '../../shared/models/taste-profile';
import { syncTabWithUrl } from '../../core/utils/tab-url';
import {
  MealPlan,
  MealTimes,
  mealPlanPatch,
  mealTimesPatch,
  resolveMealPlan,
  resolveMealTimes
} from '../../core/meal-times';
import { MealHoursComponent } from '../../shared/components/ui/meal-hours/meal-hours.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';

/**
 * Preferencias del comensal: lo que la IA tiene en cuenta al cocinar.
 *
 * Es una seccion propia (no esta en Configuracion, que habla de la app: tema,
 * idioma...) y va por pestañas, una por asunto, porque mezclar 14 alérgenos,
 * los gustos y el objetivo en una sola página no se acaba nunca. La pestaña
 * viaja en la URL (/preferences?tab=goal) como en el resto de la app.
 */
type PreferencesTab = 'profile' | 'allergies' | 'tastes' | 'meals' | 'goal';

const PREFERENCES_TABS = ['profile', 'allergies', 'tastes', 'meals', 'goal'] as const;

@Component({
  selector: 'app-preferences',
  standalone: true,
  imports: [
    TranslatePipe,

    CommonModule,
    FormsModule,
    RouterLink,
    ButtonComponent,
    ChipSelectComponent,
    HomeProfilePickerComponent,
    IconComponent,
    MealHoursComponent
  ],
  template: `
    <div class="preferences-page">
      <header class="preferences__head">
        <div>
          <h1 class="page-heading preferences__title">{{ 'nav.preferences' | t }}</h1>
          <p class="preferences__subtitle">
            {{ 'preferences.tu_perfil_alergias_gustos' | t }}
          </p>
        </div>
        <a class="preferences__redo" routerLink="/onboarding">{{
          'preferences.rehacer_la_configuracion_inicial' | t
        }}</a>
      </header>

      <div class="preferences__tabs" role="tablist">
        <button
          *ngFor="let tab of tabs"
          type="button"
          class="tab"
          role="tab"
          [attr.aria-selected]="activeTab() === tab.id"
          [class.tab--active]="activeTab() === tab.id"
          [attr.data-test]="'preferences-tab-' + tab.id"
          (click)="switchTab(tab.id)"
        >
          <app-icon [name]="tab.icon" [size]="16" />
          {{ tab.labelKey | t }}
          <span class="tab__count" *ngIf="tab.count() as count">{{ count }}</span>
        </button>
      </div>

      <p class="preferences__notice" *ngIf="!tasteService.hasProfile() && !profile.modules.length">
        {{ 'preferences.todavia_no_has_marcado' | t }}
      </p>

      <section class="preferences__panel" [ngSwitch]="activeTab()">
        <!-- ── Perfil del hogar: nivel y qué se quiere usar ── -->
        <ng-container *ngSwitchCase="'profile'">
          <h2 class="preferences__panel-title">{{ 'preferences.tu_perfil' | t }}</h2>
          <p class="preferences__panel-hint">
            {{ 'preferences.lo_que_contestaste_al' | t }}
            <a routerLink="/settings" class="preferences__inline-link">{{ 'nav.settings' | t }}</a
            >{{ 'preferences.son_de_la_app' | t }}
          </p>
          <app-home-profile-picker
            [(profile)]="profile"
            [askForModules]="false"
          ></app-home-profile-picker>
        </ng-container>

        <!-- ── Alergias e intolerancias ── -->
        <ng-container *ngSwitchCase="'allergies'">
          <h2 class="preferences__panel-title">{{ 'preferences.alergias_o_intolerancias' | t }}</h2>
          <p class="preferences__panel-hint">
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

        <!-- ── Gustos ── -->
        <ng-container *ngSwitchCase="'tastes'">
          <h2 class="preferences__panel-title">{{ 'preferences.que_te_gusta_y' | t }}</h2>
          <p class="preferences__panel-hint">
            {{ 'preferences.sirve_para_priorizar_unos' | t }}
          </p>

          <div class="preferences__field">
            <h3 class="preferences__field-title">
              <app-icon name="favorite" [size]="16" /> {{ 'preferences.me_gusta' | t }}
            </h3>
            <app-chip-select
              [label]="'preferences.lo_que_mas_te' | t"
              [options]="likeOptions"
              [(value)]="taste.likes"
              [customPlaceholder]="'ui.otro_alimento_o_tipo_de_cocina' | t"
            ></app-chip-select>
          </div>

          <div class="preferences__field">
            <h3 class="preferences__field-title">
              <app-icon name="remove_circle" [size]="16" /> {{ 'preferences.mejor_no' | t }}
            </h3>
            <app-chip-select
              [label]="'preferences.lo_que_prefieres_evitar' | t"
              [options]="dislikeOptions"
              [(value)]="taste.dislikes"
              [customPlaceholder]="'ui.otro_alimento_que_no_te_gusta' | t"
            ></app-chip-select>
          </div>

          <div class="preferences__field">
            <label class="preferences__field-title" for="tasteNotes">
              {{ 'preferences.otras_notas_para_la' | t }}
            </label>
            <textarea
              id="tasteNotes"
              name="tasteNotes"
              class="preferences__textarea"
              rows="3"
              maxlength="1000"
              [placeholder]="'preferences.ej_ceno_pronto_nada' | t"
              [(ngModel)]="taste.notes"
            ></textarea>
          </div>
        </ng-container>

        <!-- ── Horarios de las comidas ── -->
        <ng-container *ngSwitchCase="'meals'">
          <h2 class="preferences__panel-title">{{ 'preferences.a_que_hora_comes' | t }}</h2>
          <p class="preferences__panel-hint">
            {{ 'preferences.no_es_un_adorno' | t }}
          </p>

          <app-meal-hours [times]="mealTimes" [plan]="mealPlan" dataTest="preferences-meal-time" />

          <p class="preferences__footnote">
            {{ 'preferences.al_lado_de_cada' | t }}
          </p>
        </ng-container>

        <!-- ── Objetivo ── -->
        <ng-container *ngSwitchCase="'goal'">
          <h2 class="preferences__panel-title">{{ 'preferences.cual_es_tu_objetivo' | t }}</h2>
          <p class="preferences__panel-hint">
            {{ 'preferences.marca_el_plato_no' | t }}
          </p>

          <div class="preferences__goals">
            <button
              *ngFor="let goal of goalOptions"
              type="button"
              class="preferences__goal"
              [class.preferences__goal--on]="taste.goals.includes(goal.value)"
              [attr.aria-pressed]="taste.goals.includes(goal.value)"
              (click)="toggleGoal(goal.value)"
            >
              <span class="preferences__goal-icon">
                <app-icon [name]="goal.icon" [size]="20" [label]="null" />
              </span>
              <span class="preferences__goal-label">{{ goal.labelKey | t }}</span>
              <span class="preferences__goal-hint">{{ goal.hintKey | t }}</span>
            </button>
          </div>

          <div class="preferences__field">
            <label class="preferences__field-title" for="goalNotes">
              {{
                taste.goals.includes('custom')
                  ? ('calendar.describe_tu_objetivo' | t)
                  : ('onboarding.mas_sobre_el_objetivo' | t)
              }}
            </label>
            <textarea
              id="goalNotes"
              name="goalNotes"
              class="preferences__textarea"
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

          <p class="preferences__footnote">
            {{ 'preferences.falta_cacharro_los_utensilios' | t }}
            <a routerLink="/pantry" [queryParams]="{ tab: 'utensils' }">{{
              'preferences.la_despensa' | t
            }}</a
            >{{ 'preferences.si_no_tienes_horno' | t }}
          </p>
        </ng-container>
      </section>

      <footer class="preferences__actions">
        <app-button variant="primary" [loading]="tasteService.isLoading()" (onClick)="save()">
          {{ 'preferences.guardar_preferencias' | t }}
        </app-button>
        <app-button *ngIf="hasUnsavedChanges()" variant="ghost" (onClick)="discard()">
          {{ 'preferences.descartar_cambios' | t }}
        </app-button>
        <span
          class="preferences__state preferences__state--ok"
          *ngIf="saved() && !hasUnsavedChanges()"
        >
          <app-icon name="check_circle" [size]="16" /> {{ 'preferences.todo_guardado' | t }}
        </span>
        <span class="preferences__state" *ngIf="hasUnsavedChanges()">{{
          'preferences.hay_cambios_sin_guardar' | t
        }}</span>
      </footer>
    </div>
  `,
  styles: [
    `
      .preferences-page {
        padding-block: var(--container-padding);
        max-width: 1360px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .preferences__head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .preferences__subtitle {
        margin-top: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
        max-width: 52ch;
      }
      .preferences__redo {
        font-size: var(--text-sm);
        color: var(--primary);
        white-space: nowrap;
        &:hover {
          text-decoration: underline;
        }
      }

      .preferences__tabs {
        display: flex;
        gap: var(--space-2);
        min-width: 0;
        max-width: 100%;
        border-bottom: 1px solid var(--border-default);
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
      }
      .tab {
        min-height: 44px;
        flex: 0 0 auto;
        white-space: nowrap;
        background: none;
        border: none;
        padding: var(--space-3) var(--space-4);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        transition: var(--transition-fast);
        &:hover {
          color: var(--text-primary);
        }
        &--active {
          color: var(--primary);
          border-bottom-color: var(--primary);
        }
      }
      .tab__count {
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        padding: 1px 8px;
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .tab--active .tab__count {
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }

      .preferences__notice {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        background: var(--bg-secondary);
        border: 1px dashed var(--border-default);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-4);
      }

      .preferences__panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .preferences__panel-title {
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .preferences__panel-hint {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-top: calc(-1 * var(--space-3));
      }
      .preferences__field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .preferences__field-title {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .preferences__textarea {
        width: 100%;
        padding: var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        color: var(--text-primary);
        background: var(--bg-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        resize: vertical;
        &:focus {
          outline: none;
          border-color: var(--primary);
        }
      }

      .preferences__goals {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--space-3);
      }
      .preferences__goal {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-3) var(--space-4);
        text-align: left;
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
        &:hover {
          border-color: var(--border-strong);
        }
        &--on {
          border-color: var(--primary);
          background: var(--primary-subtle);
        }
      }
      .preferences__goal-icon {
        font-size: var(--text-lg);
      }
      .preferences__goal-label {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .preferences__goal-hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .preferences__footnote {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        a {
          color: var(--primary);
        }
      }

      .preferences__actions {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding-top: var(--space-3);
        border-top: 1px solid var(--border-default);
      }
      .preferences__state {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .preferences__state--ok {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        color: var(--success);
      }

      @media (max-width: 600px) {
        .preferences__actions {
          flex-wrap: wrap;
          align-items: flex-start;
        }

        .preferences__actions > app-button {
          max-width: 100%;
        }

        .preferences__state {
          flex: 1 1 100%;
        }
      }
    `
  ]
})
export class PreferencesComponent implements OnInit {
  /** Publico: la plantilla lee el estado de guardado del servicio. */
  readonly tasteService = inject(TasteProfileService);
  private readonly toastService = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly activeTab = signal<PreferencesTab>('profile');

  /**
   * Las pestanas, en una lista: anadir una seccion no es copiar y pegar un boton con su emoji.
   * El contador es una funcion porque lee senales: si no, se quedaria con el valor de la primera
   * pasada y la pestana dejaria de contar lo que se marca.
   */
  /**
   * Las pestanas, en una lista: anadir una seccion no es copiar y pegar un boton con su emoji.
   * El contador es una funcion porque lee senales: si no, se quedaria con el valor de la primera
   * pasada y la pestana dejaria de contar lo que se marca.
   *
   * `labelKey` en lugar de `label`: la lista se construye una vez al crear el componente, y un texto que
   * se guarda ahi ya no se entera del idioma (12s-B). La traduccion se hace al pintar.
   */
  readonly tabs: Array<{
    id: PreferencesTab;
    labelKey: TranslationKey;
    icon: IconName;
    count: () => string | number;
  }> = [
    {
      id: 'profile',
      labelKey: 'preferences.tab_profile',
      icon: 'person',
      count: () => this.profileLabel()
    },
    {
      id: 'allergies',
      labelKey: 'preferences.tab_allergies',
      icon: 'error_outline',
      count: () => this.taste.allergies.length
    },
    {
      id: 'tastes',
      labelKey: 'preferences.tab_tastes',
      icon: 'favorite',
      count: () => this.taste.likes.length + this.taste.dislikes.length
    },
    {
      id: 'meals',
      labelKey: 'preferences.tab_meals',
      icon: 'schedule',
      count: () => this.mealTimesLabel()
    },
    { id: 'goal', labelKey: 'calendar.objetivo', icon: 'flag', count: () => this.goalLabel() }
  ];

  /** Copia editable de las horas de la casa; lo guardado se compara contra `savedMealTimes`. */
  mealTimes: MealTimes = resolveMealTimes(null);
  private savedMealTimes: MealTimes = resolveMealTimes(null);
  /** Y lo mismo con quien rellena cada comida (12t-T): el bloqueo es una preferencia de la casa. */
  mealPlan: MealPlan = resolveMealPlan(null);
  private savedMealPlan: MealPlan = resolveMealPlan(null);

  allergenOptions = COMMON_ALLERGENS;
  likeOptions = COMMON_LIKES;
  dislikeOptions = COMMON_DISLIKES;
  goalOptions = GOAL_OPTIONS;

  /** Copia editable: nada viaja al backend hasta pulsar «Guardar preferencias». */
  taste: TasteProfile = emptyTasteProfile();
  profile: HomeProfile = DEFAULT_HOME_PROFILE;

  readonly saved = signal(false);
  private savedSnapshot = this.snapshot();

  constructor() {
    // Convencion de la app: la pestaña activa se refleja en la URL.
    syncTabWithUrl<PreferencesTab>({
      param: 'tab',
      values: PREFERENCES_TABS,
      fallback: 'profile',
      current: () => this.activeTab(),
      onChange: (tab) => this.activeTab.set(tab)
    });
  }

  ngOnInit(): void {
    // El onboarding puede haber cambiado el perfil hace un momento: se pide
    // siempre, no vale el que pudo cargar el layout al abrir la app.
    this.tasteService.load().subscribe({
      next: (data) => {
        this.taste = normalizeTasteProfile(data.taste);
        this.profile = toHomeProfile(data.profile);
        // El servicio ya ha normalizado (y la API contesta siempre las cuatro): aqui no se vuelve a
        // resolver el JSON, se copia lo que hay para poder editarlo.
        this.mealTimes = this.tasteService.mealTimes();
        this.mealPlan = this.tasteService.mealPlan();
        this.markSaved();
      },
      error: () =>
        this.toastService.error(
          this.i18n.t('ui.error'),
          this.i18n.t('profile.no_se_pudieron_cargar')
        )
    });
  }

  switchTab(tab: PreferencesTab): void {
    this.activeTab.set(tab);
  }

  /** El objetivo en palabras, para que la pestaña no muestre el valor interno. */
  goalLabel(): string {
    return (
      this.goalOptions
        .filter((option) => this.taste.goals.includes(option.value))
        .map((option) => this.i18n.t(option.labelKey))
        .join(' · ') || '—'
    );
  }

  toggleGoal(goal: TasteProfile['goals'][number]): void {
    this.taste.goals = toggleTasteGoal(this.taste.goals, goal);
  }

  /**
   * El resumen de la pestana: de la primera a la ultima hora del dia. Muestra las dos que mas se
   * miran (cuando se desayuna y cuando se cena) y, sobre todo, cambia de aspecto en cuanto se toca.
   */
  mealTimesLabel(): string {
    return `${this.mealTimes.breakfast}\u2013${this.mealTimes.dinner}`;
  }

  hasUnsavedChanges(): boolean {
    return this.snapshot() !== this.savedSnapshot;
  }

  /** En la pestaña no se muestra el valor interno ('none'), sino su nombre: la palabra, no la clave. */
  profileLabel(): string {
    return cookingLevelWord(this.profile.cookingLevel, (clave) => this.i18n.t(clave));
  }

  save(): void {
    // Solo el nivel: los modulos son de Configuracion y no se pisan desde aqui.
    this.tasteService
      .save(
        this.taste,
        undefined,
        { cookingLevel: this.profile.cookingLevel },
        // Solo lo que ha cambiado: «no he tocado la cena» no puede reescribir la cena (ver
        // `mealTimesPatch`, que es lo mismo que usa el onboarding).
        mealTimesPatch(this.mealTimes, this.savedMealTimes),
        mealPlanPatch(this.mealPlan, this.savedMealPlan)
      )
      .subscribe({
        next: () => {
          this.markSaved();
          this.saved.set(true);
          this.toastService.success(
            this.i18n.t('ui.guardado'),
            this.i18n.t('profile.la_ia_tendra_en')
          );
        },
        error: () =>
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('profile.no_se_pudo_guardar')
          )
      });
  }

  /** Vuelve a lo guardado sin recargar la página. */
  discard(): void {
    const snapshot = JSON.parse(this.savedSnapshot) as {
      taste: TasteProfile;
      profile: HomeProfile;
      mealTimes: MealTimes;
      mealPlan: MealPlan;
    };
    this.taste = snapshot.taste;
    this.profile = snapshot.profile;
    this.mealTimes = { ...snapshot.mealTimes };
    this.mealPlan = { ...snapshot.mealPlan };
    this.saved.set(false);
  }

  private snapshot(): string {
    return JSON.stringify({
      taste: this.taste,
      profile: this.profile,
      mealTimes: this.mealTimes,
      mealPlan: this.mealPlan
    });
  }

  private markSaved(): void {
    this.savedSnapshot = this.snapshot();
    this.savedMealTimes = { ...this.mealTimes };
    this.savedMealPlan = { ...this.mealPlan };
  }
}
