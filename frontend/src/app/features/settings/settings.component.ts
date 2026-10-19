import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ThemeService, Theme } from '../../core/services/theme.service';
import { I18nService, Language } from '../../core/services/i18n.service';
import { ModulesService } from '../../core/services/modules.service';
import { DashboardPreferencesService } from '../../core/services/dashboard-preferences.service';
import type { HomeModule } from '../../shared/models/home-profile';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { SwitchComponent } from '../../shared/components/ui/switch/switch.component';

interface Option<T extends string> {
  value: T;
  labelKey: TranslationKey;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    IconComponent,
    InputComponent,
    SwitchComponent
  ],
  template: `
    <div class="settings-page">
      <h1 class="settings-title">
        <app-icon name="settings" [size]="24" [label]="null" />
        {{ 'settings.title' | t }}
      </h1>

      <section class="settings-group">
        <h2 class="settings-group__title">{{ 'settings.theme' | t }}</h2>
        <div class="settings-options">
          <button
            *ngFor="let opt of themeOptions"
            type="button"
            class="settings-option"
            [class.settings-option--active]="themeService.theme() === opt.value"
            [attr.aria-pressed]="themeService.theme() === opt.value"
            (click)="setTheme(opt.value)"
          >
            {{ opt.labelKey | t }}
          </button>
        </div>
        <p class="settings-hint" *ngIf="themeService.theme() === 'system'">
          {{
            'settings.themeDetected'
              | t
                : {
                    theme: themeService.isDark()
                      ? ('settings.theme.dark' | t)
                      : ('settings.theme.light' | t)
                  }
          }}
        </p>
      </section>

      <section class="settings-group">
        <h2 class="settings-group__title">{{ 'settings.language' | t }}</h2>
        <div class="settings-options">
          <button
            *ngFor="let opt of langOptions"
            type="button"
            class="settings-option"
            [class.settings-option--active]="i18n.lang() === opt.value"
            [attr.aria-pressed]="i18n.lang() === opt.value"
            [attr.data-test]="'settings-lang-' + opt.value"
            (click)="setLang(opt.value)"
          >
            {{ opt.labelKey | t }}
          </button>
        </div>
      </section>

      <section class="settings-group" data-test="settings-today">
        <h2 class="settings-group__title">{{ 'settings.today' | t }}</h2>
        <app-input
          id="settings-expiry-horizon-days"
          name="expiryHorizonDays"
          type="number"
          size="lg"
          min="1"
          max="30"
          step="1"
          [label]="'settings.expiryDays' | t"
          [helper]="'settings.expiryDaysHint' | t"
          [error]="expiryHorizonInvalid ? ('settings.expiryDaysError' | t) : ''"
          [(ngModel)]="expiryHorizonDraft"
          (ngModelChange)="updateExpiryHorizon($event)"
          data-test="settings-expiry-horizon-days"
        ></app-input>
      </section>

      <section class="settings-group">
        <h2 class="settings-group__title">
          <app-icon name="tune" [size]="18" [label]="null" />
          {{ 'settings.modules' | t }}
        </h2>
        <p class="settings-hint">{{ 'settings.modulesHint' | t }}</p>

        <ul class="settings-modules">
          <li
            *ngFor="let def of modules.registry"
            class="settings-module"
            [attr.data-module]="def.id"
          >
            <span class="settings-module__text">
              <span class="settings-module__label" [id]="'settings-module-label-' + def.id">
                {{ def.labelKey | t }}
                <span class="settings-module__soon" *ngIf="!def.available">
                  {{ 'settings.modulesSoon' | t }}
                </span>
              </span>
              <span class="settings-module__hint" [id]="'settings-module-hint-' + def.id">
                {{ def.hintKey | t }}
              </span>
            </span>
            <app-switch
              class="settings-module__switch"
              [attr.data-module-switch]="def.id"
              [checked]="modules.isEnabled(def.id)"
              [disabled]="
                (!modules.profileLoaded() && modules.profileLoading()) ||
                !modules.canSwitchOff(def.id)
              "
              [busy]="modules.isSaving()"
              [labelledBy]="'settings-module-label-' + def.id"
              [describedBy]="'settings-module-hint-' + def.id"
              (checkedChange)="toggleModule(def.id)"
            />
          </li>
        </ul>

        <p class="settings-hint" *ngIf="modules.selected().length === 0">
          {{ 'settings.modulesAllOn' | t }}
        </p>
        <button
          type="button"
          class="settings-modules__reset"
          *ngIf="modules.selected().length > 0"
          [disabled]="modules.isSaving()"
          (click)="modules.resetSelection()"
          data-modules-reset
        >
          {{ 'settings.modulesReset' | t }}
        </button>
        <p
          class="settings-hint settings-hint--error"
          role="alert"
          aria-atomic="true"
          *ngIf="modules.lastError()"
        >
          {{ 'settings.modulesFailed' | t }}
        </p>
      </section>
    </div>
  `,
  styles: [
    `
      /*
     * ── Estados de interaccion (HOGARIA-SPEC 12q-B) ───────────────────────────────────────────
     *
     * Todo lo que se pulsa avisa antes de que se pulse. Va aqui arriba, junto, en lugar de repartido por
     * las reglas de cada control: asi la proxima clase que se anada se compara con esta lista, y el
     * check-ui (regla boton-sin-afecto) no deja a nadie poner un boton sin su hover. Van sin :hover los
     * deshabilitados —un boton apagado que se ilumina es la manera mas rapida de ensenar a desconfiar.
     */
      .settings-modules__reset:hover:not(:disabled) {
        color: var(--primary-dark);
        background: var(--primary-subtle);
      }

      .settings-modules__reset:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .settings-page {
        padding-block: var(--container-padding);
        max-width: 640px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }

      .settings-title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
      }

      .settings-modules__reset {
        margin-top: var(--space-2);
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        font-size: var(--text-xs);
        color: var(--primary);
        text-decoration: underline;
        cursor: pointer;
      }

      .settings-modules {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .settings-module {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
      }

      .settings-module__text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .settings-module__label {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--font-bold);
      }

      .settings-module__soon {
        font-size: 10px;
        font-weight: var(--font-medium);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
      }

      .settings-module__hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .settings-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .settings-group__title {
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        margin: 0;
      }

      .settings-options {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-2);
      }

      @media (max-width: 480px) {
        .settings-options {
          grid-template-columns: 1fr;
        }
      }

      .settings-option {
        min-height: 44px;
        padding: var(--space-3) var(--space-4);
        background: var(--bg-secondary);
        border: 2px solid var(--border-default);
        border-radius: var(--radius-lg);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        color: var(--text-primary);
        cursor: pointer;
        transition: var(--transition-fast);
        text-align: center;

        &:hover {
          border-color: var(--border-strong);
        }

        &--active {
          border-color: var(--primary);
          background: var(--primary-subtle);
          color: var(--primary-dark);
          font-weight: var(--font-semibold);
        }
      }

      .settings-hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        margin: 0;
      }
    `
  ]
})
export class SettingsComponent {
  themeService = inject(ThemeService);
  i18n = inject(I18nService);
  /** Secciones de la app: se activan aqui y se aplican sin recargar. */
  modules = inject(ModulesService);
  readonly dashboardPreferences = inject(DashboardPreferencesService);
  expiryHorizonDraft = this.dashboardPreferences.expiryHorizonDays();
  expiryHorizonInvalid = false;

  themeOptions: Option<Theme>[] = [
    { value: 'light', labelKey: 'settings.theme.light' },
    { value: 'dark', labelKey: 'settings.theme.dark' },
    { value: 'system', labelKey: 'settings.theme.system' }
  ];

  langOptions: Option<Language>[] = [
    { value: 'auto', labelKey: 'settings.lang.auto' },
    { value: 'es', labelKey: 'settings.lang.es' },
    { value: 'en', labelKey: 'settings.lang.en' }
  ];

  setTheme(t: Theme): void {
    this.themeService.setTheme(t);
  }

  setLang(l: Language): void {
    this.i18n.setLang(l);
  }

  updateExpiryHorizon(value: string | number): void {
    if (this.dashboardPreferences.setExpiryHorizonDays(value)) {
      this.expiryHorizonDraft = this.dashboardPreferences.expiryHorizonDays();
      this.expiryHorizonInvalid = false;
      return;
    }

    this.expiryHorizonInvalid = true;
  }

  toggleModule(id: HomeModule): void {
    if (
      (!this.modules.profileLoaded() && this.modules.profileLoading()) ||
      this.modules.isSaving() ||
      !this.modules.canSwitchOff(id)
    )
      return;
    this.modules.toggle(id);
  }
}
