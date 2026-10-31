import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { AiProviderAvailabilityService } from '../../core/services/ai-provider-availability.service';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import type { TranslationKey } from '../../core/i18n';
import type { AiFunctionKey } from '../models/ai-config.model';
import { ButtonComponent } from './ui/button/button.component';
import { ModalComponent } from './ui/modal/modal.component';

const FUNCTION_LABELS: Record<AiFunctionKey, TranslationKey> = {
  assistant: 'ai_config.function_assistant',
  recipes: 'ai_config.function_recipes',
  planning: 'ai_config.function_planning',
  shopping_pantry: 'ai_config.function_shopping_pantry',
  household_automation: 'ai_config.function_household_automation'
};

@Component({
  selector: 'app-ai-provider-required-dialog',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, ButtonComponent, ModalComponent],
  template: `
    @if (availability.setupFunction() && translationsReady()) {
      <app-modal
        [isOpen]="true"
        [title]="'ai_config.provider_required_title' | t"
        size="sm"
        (onClose)="close()"
      >
        <p class="provider-required__copy">{{ 'ai_config.provider_required_body' | t }}</p>
        <p class="provider-required__function">
          {{ 'ai_config.provider_required_function' | t: { function: functionLabel() } }}
        </p>
        <p *ngIf="needsSettingsPermission()" class="provider-required__permission">
          {{ 'ai_config.provider_required_permission' | t }}
        </p>
        <div class="provider-required__actions">
          <app-button variant="ghost" type="button" (onClick)="close()">
            {{ 'common.cancel' | t }}
          </app-button>
          <a
            class="provider-required__link"
            [routerLink]="setupCommands()"
            [queryParams]="setupQueryParams()"
            (click)="close()"
          >
            {{ 'ai_config.open_settings' | t }}
          </a>
        </div>
      </app-modal>
    }
  `,
  styles: [
    `
      .provider-required__copy,
      .provider-required__permission {
        color: var(--text-secondary);
        margin: 0;
      }

      .provider-required__function {
        margin: var(--space-3) 0;
        color: var(--text-primary);
        font-weight: var(--font-semibold);
      }

      .provider-required__actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-top: var(--space-5);
      }

      .provider-required__link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 var(--space-4);
        border-radius: var(--radius-md);
        background: var(--primary);
        color: var(--white);
        font-weight: var(--font-semibold);
        text-decoration: none;
      }

      .provider-required__link:hover {
        background: var(--primary-dark);
      }

      .provider-required__link:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 3px;
      }
    `
  ]
})
export class AiProviderRequiredDialogComponent {
  readonly availability = inject(AiProviderAvailabilityService);
  private readonly household = inject(HouseholdService);
  private readonly i18n = inject(I18nService);
  readonly needsSettingsPermission = computed(() => {
    const activeId = this.household.activeHouseholdId();
    if (!activeId) return false;
    const active = this.household.memberships().find((membership) => membership.id === activeId);
    return Boolean(active && active.role !== 'admin' && active.permissions.settings !== true);
  });
  readonly translationsReady = signal(false);
  readonly functionLabel = computed(() => {
    const functionKey = this.availability.setupFunction();
    return this.i18n.t(functionKey ? FUNCTION_LABELS[functionKey] : 'ai_config.function_assistant');
  });
  readonly setupCommands = computed(() =>
    this.household.activeHouseholdId() || this.household.memberships().length > 0
      ? ['/household']
      : ['/ai-config']
  );
  readonly setupQueryParams = computed(() =>
    this.household.activeHouseholdId() || this.household.memberships().length > 0
      ? { tab: 'settings' }
      : null
  );

  constructor() {
    effect(() => {
      const open = this.availability.setupFunction() !== null;
      if (!open) {
        this.translationsReady.set(false);
        return;
      }
      this.translationsReady.set(false);
      void this.i18n
        .loadTranslations('aiConfig', 'household')
        .catch(() => undefined)
        .finally(() => this.translationsReady.set(true));
    });
  }

  close(): void {
    this.availability.closeSetup();
  }
}
