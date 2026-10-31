import { Component, computed, DestroyRef, inject, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from '../../core/services/ai.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { AIProviderConfig, AIProvider, AiFunctionKey } from '../../shared/models/ai-config.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, exhaustMap, interval, merge } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiProviderAvailabilityService } from '../../core/services/ai-provider-availability.service';
import type { TranslationKey } from '../../core/i18n';

const FUNCTION_LABELS: Record<AiFunctionKey, TranslationKey> = {
  assistant: 'ai_config.function_assistant',
  recipes: 'ai_config.function_recipes',
  planning: 'ai_config.function_planning',
  shopping_pantry: 'ai_config.function_shopping_pantry',
  household_automation: 'ai_config.function_household_automation'
};

@Component({
  selector: 'app-ai-config',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    BadgeComponent,
    ModalComponent,
    LoadingComponent,
    IconComponent,
    RouterLink
  ],
  template: `
    <div class="ai-config" [class.ai-config--embedded]="embedded">
      <!-- Header -->
      <div class="ai-config__header">
        <div class="ai-config__title-section">
          <app-icon name="smart_toy" [size]="24" [label]="null" />
          <h1 *ngIf="!embedded; else embeddedTitle" class="ai-config__title">
            {{ 'ai_config.configuracion_ia' | t }}
          </h1>
          <ng-template #embeddedTitle>
            <h2 class="ai-config__title">{{ 'ai_config.configuracion_ia' | t }}</h2>
          </ng-template>
          <span *ngIf="aiService.configs().length > 0" class="ai-config__count">
            {{ configuracionesLabel() }}
          </span>
        </div>
        <app-button
          *ngIf="
            aiService.configs().length > 0 || aiService.configsLoading() || aiService.configsError()
          "
          variant="primary"
          (onClick)="openAddModal()"
        >
          <app-icon name="add" [size]="18" [label]="null" />
          {{ 'ai_config.agregar_configuracion' | t }}
        </app-button>
      </div>

      <!-- Info -->
      <div *ngIf="aiService.configs().length > 0" class="ai-config__info">
        <p>{{ 'ai_config.conecta_tu_proveedor_de' | t }}</p>
      </div>

      <section
        *ngIf="aiService.configs().length > 0"
        class="function-provider-settings"
        aria-labelledby="ai-function-providers-title"
        data-test="ai-function-providers"
      >
        <div class="function-provider-settings__header">
          <div>
            <h2 id="ai-function-providers-title">
              {{ 'ai_config.function_providers_title' | t }}
            </h2>
            <p>{{ 'ai_config.function_providers_hint' | t }}</p>
          </div>
        </div>
        <div class="function-provider-settings__grid">
          <div class="function-provider-row" *ngFor="let key of aiFunctionKeys">
            <label [for]="'ai-function-provider-' + key">{{ functionLabel(key) | t }}</label>
            <ng-container *ngIf="activeProviders().length > 1; else fixedProvider">
              <select
                [id]="'ai-function-provider-' + key"
                [ngModel]="assignmentFor(key)?.configId ?? ''"
                (ngModelChange)="assignProvider(key, $event)"
                [name]="'provider-' + key"
                [attr.aria-label]="functionLabel(key) | t"
                [attr.data-test]="'ai-function-provider-' + key"
              >
                <option *ngFor="let provider of activeProviders()" [ngValue]="provider.id">
                  {{ provider.name }}
                </option>
              </select>
            </ng-container>
            <ng-template #fixedProvider>
              <span *ngIf="activeProviders().length === 1" class="function-provider-row__value">
                {{ activeProviders()[0].name }}
              </span>
              <span *ngIf="activeProviders().length === 0" class="function-provider-row__value">
                {{ 'ai_config.no_active_provider' | t }}
              </span>
            </ng-template>
          </div>
        </div>
      </section>

      <!-- Configs List -->
      <div class="ai-config__list">
        <div
          *ngIf="aiService.configsLoading() && aiService.configs().length === 0"
          class="ai-config__loading"
          role="status"
          aria-live="polite"
        >
          <app-loading [message]="'ai_config.loading_configs' | t" [inline]="true" />
        </div>

        <div
          *ngIf="aiService.configsError()"
          class="ai-config__load-error"
          role="alert"
          aria-atomic="true"
        >
          <div>
            <strong>{{ 'ai_config.configs_load_error' | t }}</strong>
            <p>{{ 'ai_config.configs_load_error_hint' | t }}</p>
          </div>
          <app-button
            variant="outline"
            type="button"
            [touchTarget]="true"
            [disabled]="aiService.configsLoading()"
            (onClick)="aiService.loadConfigs()"
            data-test="retry-ai-configs"
          >
            <app-icon name="refresh" [size]="16" [label]="null" />
            {{ 'ai_config.retry' | t }}
          </app-button>
        </div>

        <div
          *ngFor="let config of aiService.configs()"
          class="config-card"
          [class.config-card--active]="config.isActive"
        >
          <div class="config-card__header">
            <div class="config-card__info">
              <h3 class="config-card__name">{{ config.name }}</h3>
              <span class="config-card__provider">{{ config.provider }}</span>
            </div>
            <div class="config-card__status">
              <app-badge [variant]="config.isActive ? 'success' : 'neutral'" size="sm">
                {{ (config.isActive ? 'ai_config.activo' : 'ai_config.inactivo') | t }}
              </app-badge>
              <app-badge
                *ngIf="config.testStatus"
                [variant]="getTestStatusVariant(config.testStatus)"
                size="sm"
              >
                {{ getTestStatusLabel(config.testStatus) }}
              </app-badge>
            </div>
          </div>

          <div class="config-card__details">
            <div class="config-detail">
              <span class="config-detail__label">{{ 'ai_config.url' | t }}</span>
              <span class="config-detail__value">{{ config.baseUrl }}</span>
            </div>
            <div class="config-detail">
              <span class="config-detail__label">{{ 'ai_config.modelo' | t }}</span>
              <span class="config-detail__value">{{ config.model }}</span>
            </div>
            <div class="config-detail">
              <span class="config-detail__label">{{ 'ai_config.temperatura' | t }}</span>
              <span class="config-detail__value">{{ config.temperature }}</span>
            </div>
          </div>

          <div class="config-card__actions">
            <a
              *ngIf="config.concurrency > 0"
              class="config-card__queue-link"
              [routerLink]="['/ai-config', config.id, 'queue']"
              data-test="ai-queue-link"
            >
              <app-icon name="schedule" [size]="16" [label]="null" />
              {{ 'ai_config.queue_open' | t }}
            </a>
            <app-button
              variant="ghost"
              size="sm"
              type="button"
              [touchTarget]="true"
              [loading]="probandoId() === config.id || config.testStatus === 'testing'"
              [disabled]="isTestActionDisabled(config)"
              (onClick)="testConfig(config)"
              [attr.data-test]="'probar-' + config.name"
            >
              <app-icon name="link" [size]="16" [label]="null" />
              {{
                (probandoId() === config.id || config.testStatus === 'testing'
                  ? 'ai_config.comprobando'
                  : 'ai_config.probar'
                ) | t
              }}
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              [touchTarget]="true"
              (onClick)="editConfig(config)"
            >
              <app-icon name="edit" [size]="16" [label]="null" />
              {{ 'ai_config.editar' | t }}
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              [touchTarget]="true"
              (onClick)="toggleActive(config)"
            >
              <app-icon
                [name]="config.isActive ? 'pause' : 'play_arrow'"
                [size]="16"
                [label]="null"
              />
              {{ config.isActive ? ('ai_config.desactivar' | t) : ('ai_config.activar' | t) }}
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              [touchTarget]="true"
              [disabled]="isDeleteActionDisabled(config)"
              (onClick)="deleteConfig(config)"
            >
              <app-icon name="delete" [size]="16" [label]="null" />
              {{ 'ai_config.eliminar' | t }}
            </app-button>
          </div>
        </div>

        <!-- Empty State -->
        <div
          *ngIf="
            !aiService.configsLoading() &&
            !aiService.configsError() &&
            aiService.configs().length === 0
          "
          class="empty-state"
        >
          <span class="empty-state__icon"
            ><app-icon name="smart_toy" [size]="48" [label]="null"
          /></span>
          <h3 class="empty-state__title">{{ 'ai_config.sin_configuraciones' | t }}</h3>
          <p class="empty-state__text">{{ 'ai_config.agrega_un_proveedor_de' | t }}</p>
          <app-button variant="primary" (onClick)="openAddModal()">
            {{ 'ai_config.agregar_configuracion' | t }}
          </app-button>
        </div>
      </div>

      <!-- Add/Edit Modal -->
      <app-modal
        [isOpen]="isModalOpen()"
        [title]="
          editingConfig()
            ? ('ai_config.editar_configuracion' | t)
            : ('ai_config.nueva_configuracion' | t)
        "
        size="lg"
        (onClose)="closeModal()"
      >
        <form (ngSubmit)="saveConfig()" class="config-form">
          <app-input
            id="name"
            name="configName"
            [label]="'auth.name' | t"
            [placeholder]="'ai_config.mi_proveedor_ia' | t"
            [(ngModel)]="formData.name"
            [required]="true"
          ></app-input>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label" for="provider">{{ 'ai_config.proveedor' | t }}</label>
              <select
                id="provider"
                [(ngModel)]="formData.provider"
                name="provider"
                class="form-select"
              >
                <option value="openai">{{ 'ai_config.openai' | t }}</option>
                <option value="custom">{{ 'ai_config.custom_openai_like' | t }}</option>
              </select>
            </div>

            <app-input
              id="model"
              name="model"
              [label]="'ai_config.modelo' | t"
              placeholder="gpt-4o-mini"
              [(ngModel)]="formData.model"
              [required]="true"
            ></app-input>
          </div>

          <app-input
            id="baseUrl"
            name="baseUrl"
            type="url"
            [label]="'ai_config.url_base' | t"
            placeholder="https://api.openai.com/v1"
            [(ngModel)]="formData.baseUrl"
            [required]="true"
            [helper]="'ai_config.url_helper' | t"
          ></app-input>

          <app-input
            id="apiKey"
            name="apiKey"
            type="password"
            [label]="'ai_config.api_key' | t"
            placeholder="sk-..."
            [(ngModel)]="formData.apiKey"
            [required]="!editingConfig()"
            [helper]="editingConfig() ? ('ai_config.api_key_edit_helper' | t) : ''"
          ></app-input>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label" for="temperature">{{
                'ai_config.temperatura_valor' | t: { value: formData.temperature }
              }}</label>
              <input
                id="temperature"
                type="range"
                [(ngModel)]="formData.temperature"
                name="temperature"
                min="0"
                max="2"
                step="0.1"
                class="form-range"
              />
              <span class="form-hint">{{ 'ai_config.0_preciso_2_creativo' | t }}</span>
            </div>

            <app-input
              id="maxTokens"
              name="maxTokens"
              type="number"
              [label]="'ai_config.max_tokens' | t"
              placeholder="4096"
              [(ngModel)]="formData.maxTokens"
            ></app-input>
          </div>

          <div class="form-row">
            <app-input
              id="timeout"
              name="timeout"
              type="number"
              [label]="'ai_config.timeout_ms' | t"
              placeholder="30000"
              [helper]="'ai_config.timeout_helper' | t"
              [(ngModel)]="formData.timeout"
            ></app-input>

            <app-input
              id="retryAttempts"
              name="retryAttempts"
              type="number"
              [label]="'ai_config.reintentos' | t"
              placeholder="3"
              [(ngModel)]="formData.retryAttempts"
            ></app-input>

            <app-input
              id="concurrency"
              name="concurrency"
              type="number"
              [label]="'ai_config.concurrencia' | t"
              placeholder="0"
              [min]="0"
              [max]="8"
              [step]="1"
              [helper]="'ai_config.concurrencia_helper' | t"
              [error]="concurrencyError()"
              [(ngModel)]="formData.concurrency"
              (ngModelChange)="validateConcurrency()"
            ></app-input>
          </div>

          <div class="form-actions">
            <app-button variant="ghost" type="button" [touchTarget]="true" (onClick)="closeModal()">
              {{ 'common.cancel' | t }}
            </app-button>
            <app-button
              variant="outline"
              type="button"
              [touchTarget]="true"
              [loading]="probandoForm()"
              (onClick)="testFromForm()"
              data-test="probar-formulario"
            >
              <app-icon name="link" [size]="16" [label]="null" />
              {{ (probandoForm() ? 'ai_config.comprobando' : 'ai_config.probar_conexion') | t }}
            </app-button>
            <app-button variant="primary" type="submit" [touchTarget]="true" [loading]="isSaving()">
              {{ (editingConfig() ? 'common.save' : 'common.create') | t }}
            </app-button>
          </div>
        </form>
      </app-modal>

      <!-- Test Result Modal -->
      <app-modal
        [isOpen]="isTestResultOpen()"
        [title]="'ai_config.resultado_del_test' | t"
        size="sm"
        (onClose)="closeTestResult()"
      >
        <div class="test-result" *ngIf="testResult()">
          <div
            class="test-result__icon"
            [class.test-result__icon--success]="testResult()!.success"
            [class.test-result__icon--error]="!testResult()!.success"
          >
            <app-icon
              [name]="testResult()!.success ? 'check_circle' : 'error_outline'"
              [size]="48"
              [label]="null"
            />
          </div>
          <h3 class="test-result__title">
            {{
              testResult()!.success
                ? ('ai_config.conexion_exitosa' | t)
                : ('ai_config.error_de_conexion' | t)
            }}
          </h3>
          <p *ngIf="testResult()!.model" class="test-result__detail">
            {{ 'ai_config.modelo_valor' | t: { model: testResult()!.model } }}
          </p>
          <p *ngIf="testResult()!.latency" class="test-result__detail">
            {{ 'ai_config.latencia_valor' | t: { ms: testResult()!.latency } }}
          </p>
          <p *ngIf="testResult()!.error" class="test-result__error">
            {{ testResult()!.error }}
          </p>
        </div>
      </app-modal>
    </div>
  `,
  styles: [
    `
      .ai-config {
        padding-block: var(--container-padding);
        max-width: 800px;
        margin: 0 auto;
      }

      .ai-config--embedded {
        max-width: none;
        margin: 0;
        padding-block: 0;
      }

      .ai-config__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-4);
      }

      .ai-config__title-section {
        display: flex;
        align-items: baseline;
        gap: var(--space-3);
      }

      .ai-config__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
      }

      .ai-config__count {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      @media (max-width: 600px) {
        .ai-config__header {
          align-items: flex-start;
          flex-direction: column;
          gap: var(--space-3);
        }

        .ai-config__title-section {
          flex-wrap: wrap;
          gap: var(--space-2);
          max-width: 100%;
        }
      }

      .ai-config__info {
        padding: var(--space-4);
        background: var(--info-subtle);
        border-radius: var(--radius-lg);
        margin-bottom: var(--space-6);

        p {
          font-size: var(--text-sm);
          color: var(--color-info-700);
        }
      }

      .function-provider-settings {
        margin-bottom: var(--space-6);
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
      }

      .function-provider-settings__header h2 {
        margin: 0;
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
      }

      .function-provider-settings__header p {
        margin: var(--space-1) 0 var(--space-3);
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .function-provider-settings__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
        gap: var(--space-2) var(--space-5);
      }

      .function-provider-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        min-height: 44px;
      }

      .function-provider-row label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .function-provider-row select {
        box-sizing: border-box;
        width: min(15rem, 55%);
        min-width: 9rem;
        min-height: 44px;
        padding: 0 var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }

      .function-provider-row select:focus-visible {
        outline: 2px solid var(--color-primary-600);
        outline-offset: 2px;
      }

      .function-provider-row__value {
        max-width: 55%;
        overflow-wrap: anywhere;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        text-align: right;
      }

      @media (max-width: 480px) {
        .function-provider-row {
          align-items: flex-start;
          flex-direction: column;
          justify-content: center;
          gap: var(--space-1);
        }

        .function-provider-row select,
        .function-provider-row__value {
          width: 100%;
          max-width: none;
          text-align: left;
        }
      }

      .ai-config__list {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      .ai-config__load-error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
        padding: var(--space-4);
        border: 1px solid var(--error);
        border-radius: var(--radius-lg);
        color: var(--text-primary);
        background: var(--error-subtle);

        p {
          margin-top: var(--space-1);
          font-size: var(--text-sm);
        }
      }

      /* Config Card */
      .config-card {
        padding: var(--space-4);
        background: var(--bg-secondary);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-default);
        transition: var(--transition-fast);

        &:hover {
          border-color: var(--border-strong);
        }

        &--active {
          border-color: var(--success);
        }
      }

      .config-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-4);
      }

      .config-card__info {
        display: flex;
        flex-direction: column;
      }

      .config-card__name {
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
      }

      .config-card__provider {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .config-card__status {
        display: flex;
        gap: var(--space-2);
      }

      .config-card__details {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-4);
        margin-bottom: var(--space-4);
      }

      .config-detail {
        display: flex;
        flex-direction: column;
      }

      .config-detail__label {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .config-detail__value {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        word-break: break-all;
      }

      .config-card__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }

      .config-card__queue-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        min-height: 44px;
        padding: var(--space-1) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: var(--text-xs);
        text-decoration: none;
      }

      .config-card__queue-link:hover {
        border-color: var(--border-strong);
        background: var(--bg-tertiary);
      }

      .config-card__queue-link:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      /* Form */
      .config-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }

      .form-label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .form-select {
        width: 100%;
        padding: var(--space-2) var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-base);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);

        &:focus {
          outline: none;
          border-color: var(--primary);
        }
      }

      .form-range {
        width: 100%;
        margin-top: var(--space-2);
      }

      .form-hint {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }

      .form-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: var(--space-3);
        margin-top: var(--space-4);
      }

      /* Test Result */
      .test-result {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--space-4);
        padding: var(--space-4);
      }

      .test-result__icon {
        font-size: 48px;
      }

      .test-result__icon--success {
        color: var(--success);
      }

      .test-result__icon--error {
        color: var(--error);
      }

      .test-result__title {
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
      }

      .test-result__detail {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .test-result__error {
        font-size: var(--text-sm);
        color: var(--error);
        padding: var(--space-3);
        background: var(--error-subtle);
        border-radius: var(--radius-md);
      }

      /* Empty State */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-12);
        text-align: center;
      }

      .empty-state__icon {
        font-size: 64px;
        margin-bottom: var(--space-4);
      }

      .empty-state__title {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-semibold);
        margin-bottom: var(--space-2);
      }

      .empty-state__text {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-6);
      }

      @media (max-width: 480px) {
        .ai-config__load-error {
          align-items: stretch;
          flex-direction: column;
        }

        .form-row {
          grid-template-columns: 1fr;
        }

        .config-card__details {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class AiConfigComponent implements OnInit {
  @Input() embedded = false;
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly testStatusRefresh$ = new Subject<void>();

  /** «3 configuraciones» / «1 configuración»: el numero y el sustantivo se eligen a la vez. */
  configuracionesLabel(): string {
    const n = this.aiService.configs().length;
    return this.i18n.plural(
      n,
      'ai_config.n_configuraciones_uno',
      'ai_config.n_configuraciones_varios',
      { count: n }
    );
  }

  aiService = inject(AiService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private readonly providerAvailability = inject(AiProviderAvailabilityService);
  readonly aiFunctionKeys: AiFunctionKey[] = [
    'assistant',
    'recipes',
    'planning',
    'shopping_pantry',
    'household_automation'
  ];
  readonly activeProviders = computed(() =>
    this.aiService.configs().filter((config) => config.isActive)
  );

  isModalOpen = signal(false);
  editingConfig = signal<AIProviderConfig | null>(null);
  isSaving = signal(false);
  isTestResultOpen = signal(false);
  testResult = signal<any>(null);
  /** La prueba en curso: UNA a la vez, y el boton bloqueado hasta que llegue el veredicto. */
  probandoId = signal<string | null>(null);
  probandoForm = signal(false);
  concurrencyError = signal('');

  formData = {
    name: '',
    provider: 'custom' as AIProvider,
    baseUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 30000,
    retryAttempts: 3,
    concurrency: 0
  };

  ngOnInit(): void {
    this.aiService.loadConfigs();
    this.aiService.loadFunctionProviders();
    merge(interval(2000), this.testStatusRefresh$)
      .pipe(
        exhaustMap(() =>
          this.shouldPollTestStatus() ? this.aiService.loadConfigsSnapshot() : EMPTY
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((configs) => {
        if (configs) this.handleTestStatusSnapshot(configs);
      });
  }

  openAddModal(): void {
    this.editingConfig.set(null);
    this.resetForm();
    this.isModalOpen.set(true);
  }

  editConfig(config: AIProviderConfig): void {
    this.editingConfig.set(config);
    this.concurrencyError.set('');
    this.formData = {
      name: config.name,
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: '', // Don't show existing key
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      concurrency: config.concurrency ?? 0
    };
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.editingConfig.set(null);
    this.resetForm();
  }

  saveConfig(): void {
    if (!this.validateConcurrency()) return;
    this.isSaving.set(true);

    const data: Partial<typeof this.formData> = { ...this.formData };
    if (this.editingConfig() && !data.apiKey?.trim()) {
      delete data.apiKey;
    }

    const obs = this.editingConfig()
      ? this.aiService.updateConfig(this.editingConfig()!.id, data)
      : this.aiService.createConfig(data);

    obs.subscribe({
      next: (result) => {
        if (!result) {
          this.notifySaveError();
          this.isSaving.set(false);
          return;
        }
        this.toastService.success(
          this.editingConfig()
            ? this.i18n.t('ai_config.actualizado')
            : this.i18n.t('ai_config.creado'),
          this.i18n.t('ai_config.configuracion_guardada_correctamente')
        );
        this.closeModal();
        this.isSaving.set(false);
        // La asignación inicial solo cambia al aparecer el primer proveedor activo.
        this.aiService.loadConfigs();
        this.aiService.loadFunctionProviders();
        this.providerAvailability.load(true).subscribe();
      },
      error: (error: unknown) => {
        this.notifySaveError(error);
        this.isSaving.set(false);
      }
    });
  }

  testConfig(config: AIProviderConfig): void {
    if (this.hasRunningTest() || config.testStatus === 'testing') return;
    this.probandoId.set(config.id);

    this.aiService.testConnection({ configId: config.id }).subscribe({
      next: (result) => {
        if (this.isAcceptedTest(result)) {
          this.probandoId.set(result.configId);
          this.testStatusRefresh$.next();
          return;
        }
        this.probandoId.set(null);
        if (result) this.aiService.loadConfigs();
        this.testResult.set(
          result ?? { success: false, error: this.i18n.t('ai_config.no_se_pudo_conectar') }
        );
        this.isTestResultOpen.set(true);
      },
      error: (error: unknown) => {
        this.probandoId.set(null);
        if (this.notifyValidationError(error)) return;
        this.testResult.set({
          success: false,
          error: this.i18n.t('ai_config.no_se_pudo_conectar')
        });
        this.isTestResultOpen.set(true);
      }
    });
  }

  /**
   * Probar lo que esta escrito en el formulario, SIN guardar: el server acepta los datos tal
   * cual (baseUrl+apiKey+model). Hasta que llegue el veredicto no se enseña nada —el boton se
   * queda en «Comprobando…» bloqueado— y entonces se abre el resultado, sea el que sea. (Esto
   * era un stub que soltaba un «Configuración válida» sin haber llamado a nada.)
   */
  testFromForm(): void {
    if (this.hasRunningTest()) return;
    const { baseUrl, apiKey, model, timeout } = this.formData;
    const savedConfig = this.editingConfig();
    const useSavedConfig = !!savedConfig && !apiKey.trim();
    if (!baseUrl.trim() || !model.trim() || (!apiKey.trim() && !useSavedConfig)) {
      this.toastService.warning(
        this.i18n.t('ai_config.test'),
        this.i18n.t('ai_config.faltan_datos_para_probar')
      );
      return;
    }

    this.probandoForm.set(true);
    this.aiService
      .testConnection({
        ...(useSavedConfig
          ? { configId: savedConfig!.id }
          : {
              baseUrl: baseUrl.trim(),
              apiKey: apiKey.trim(),
              model: model.trim(),
              timeout
            })
      })
      .subscribe({
        next: (result) => {
          if (this.isAcceptedTest(result)) {
            this.probandoId.set(result.configId);
            this.testStatusRefresh$.next();
            return;
          }
          this.probandoForm.set(false);
          this.testResult.set(
            result ?? { success: false, error: this.i18n.t('ai_config.no_se_pudo_conectar') }
          );
          this.isTestResultOpen.set(true);
        },
        error: (error: unknown) => {
          this.probandoForm.set(false);
          if (this.notifyValidationError(error)) return;
          this.testResult.set({
            success: false,
            error: this.i18n.t('ai_config.no_se_pudo_conectar')
          });
          this.isTestResultOpen.set(true);
        }
      });
  }

  async toggleActive(config: AIProviderConfig): Promise<void> {
    if (config.isActive && (config.assignedFunctions?.length ?? 0) > 0) {
      const accepted = await this.confirmService.confirm({
        title: this.i18n.t('ai_config.provider_in_use_title'),
        message: this.i18n.t('ai_config.provider_in_use_message', {
          name: config.name,
          functions: this.assignedFunctionNames(config)
        }),
        confirmText: this.i18n.t('ai_config.desactivar')
      });
      if (!accepted) return;
    }
    this.aiService
      .updateConfig(config.id, {
        isActive: !config.isActive
      } as any)
      .subscribe({
        next: (result) => {
          if (!result) {
            this.toastService.error(
              this.i18n.t('ui.error'),
              this.i18n.t('ai_config.no_se_pudo_actualizar')
            );
            return;
          }
          this.toastService.success(
            this.i18n.t('ai_config.actualizado'),
            config.isActive
              ? this.i18n.t('ai_config.configuracion_desactivada')
              : this.i18n.t('ai_config.configuracion_activada')
          );
          this.aiService.loadConfigs();
          this.aiService.loadFunctionProviders();
          this.providerAvailability.load(true).subscribe();
        },
        error: (error: unknown) => {
          if (this.notifyValidationError(error)) return;
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('ai_config.no_se_pudo_actualizar')
          );
        }
      });
  }

  async deleteConfig(config: AIProviderConfig): Promise<void> {
    if (this.isDeleteActionDisabled(config)) return;

    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('ai_config.eliminar_configuracion'),
      message:
        (config.assignedFunctions?.length ?? 0) > 0
          ? this.i18n.t('ai_config.delete_in_use_message', {
              name: config.name,
              functions: this.assignedFunctionNames(config)
            })
          : this.i18n.t('ai_config.eliminar_la_configuracion', { name: config.name }),
      confirmText: this.i18n.t('common.delete')
    });
    if (!accepted) return;

    this.aiService.deleteConfig(config.id).subscribe({
      next: (result) => {
        if (!result.deleted) {
          if (result.reason === 'test_running') this.aiService.loadConfigs();
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t(
              result.reason === 'test_running'
                ? 'ai_config.test_running_delete'
                : 'ai_config.no_se_pudo_eliminar'
            )
          );
          return;
        }
        this.toastService.success(
          this.i18n.t('ai_config.eliminada'),
          this.i18n.t('ai_config.configuracion_eliminada_correctamente')
        );
        this.aiService.loadConfigs();
        this.aiService.loadFunctionProviders();
        this.providerAvailability.load(true).subscribe();
      }
    });
  }

  functionLabel(functionKey: AiFunctionKey): TranslationKey {
    return FUNCTION_LABELS[functionKey];
  }

  assignmentFor(functionKey: AiFunctionKey) {
    return this.aiService
      .functionProviders()
      .find((assignment) => assignment.functionKey === functionKey);
  }

  assignProvider(functionKey: AiFunctionKey, configId: string): void {
    if (!configId) return;
    this.aiService.assignFunctionProvider(functionKey, configId).subscribe((assignment) => {
      if (!assignment) {
        this.toastService.error(
          this.i18n.t('ui.error'),
          this.i18n.t('ai_config.provider_assignment_error')
        );
        this.aiService.loadFunctionProviders();
        return;
      }
      this.providerAvailability.load(true).subscribe();
    });
  }

  private assignedFunctionNames(config: AIProviderConfig): string {
    return (config.assignedFunctions ?? [])
      .map((key) => this.i18n.t(FUNCTION_LABELS[key]))
      .join(', ');
  }

  isTestActionDisabled(config: AIProviderConfig): boolean {
    if (config.testStatus === 'testing') return this.probandoId() !== config.id;
    return this.hasRunningTest();
  }

  isDeleteActionDisabled(config: AIProviderConfig): boolean {
    return config.testStatus === 'testing' || this.probandoId() === config.id;
  }

  private hasRunningTest(): boolean {
    return (
      this.probandoId() !== null ||
      this.probandoForm() ||
      this.aiService.configs().some((config) => config.testStatus === 'testing')
    );
  }

  private shouldPollTestStatus(): boolean {
    return (
      this.probandoId() !== null ||
      this.aiService.configs().some((config) => config.testStatus === 'testing')
    );
  }

  private isAcceptedTest(result: unknown): result is { status: 'testing'; configId: string } {
    return (
      result !== null &&
      typeof result === 'object' &&
      (result as { status?: unknown }).status === 'testing' &&
      typeof (result as { configId?: unknown }).configId === 'string'
    );
  }

  private handleTestStatusSnapshot(configs: AIProviderConfig[]): void {
    const pendingId = this.probandoId();
    if (!pendingId) return;
    const config = configs.find((candidate) => candidate.id === pendingId);
    if (!config) {
      this.probandoId.set(null);
      this.probandoForm.set(false);
      return;
    }
    if (
      config.testStatus !== 'success' &&
      config.testStatus !== 'failed' &&
      config.testStatus !== 'interrupted'
    ) {
      return;
    }

    const latency = (config as AIProviderConfig & { testLatencyMs?: number }).testLatencyMs;
    this.probandoId.set(null);
    this.probandoForm.set(false);
    this.testResult.set({
      success: config.testStatus === 'success',
      model: config.model,
      latency,
      error:
        config.testStatus === 'interrupted'
          ? this.i18n.t('ai_config.test_interrupted')
          : config.testStatus === 'failed'
            ? config.testError || this.i18n.t('ai_config.no_se_pudo_conectar')
            : undefined
    });
    this.isTestResultOpen.set(true);
  }

  getTestStatusVariant(status: string): 'success' | 'error' | 'warning' {
    switch (status) {
      case 'success':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'warning';
    }
  }

  getTestStatusLabel(status: string): string {
    switch (status) {
      case 'success':
        return 'OK';
      case 'failed':
        return this.i18n.t('ui.error');
      case 'testing':
        return this.i18n.t('ai_config.probando');
      case 'interrupted':
        return this.i18n.t('ai_config.test_interrupted');
      default:
        return this.i18n.t('ai_config.pendiente');
    }
  }

  closeTestResult(): void {
    this.isTestResultOpen.set(false);
  }

  private notifySaveError(error?: unknown): void {
    if (this.notifyValidationError(error)) return;
    this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('ai_config.no_se_pudo_guardar'));
  }

  private notifyValidationError(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const response = error as { validation?: unknown; message?: unknown };
    if (response.validation !== true || typeof response.message !== 'string') return false;
    this.toastService.error(this.i18n.t('ui.error'), response.message);
    return true;
  }

  private resetForm(): void {
    this.concurrencyError.set('');
    this.formData = {
      name: '',
      provider: 'custom',
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 30000,
      retryAttempts: 3,
      concurrency: 0
    };
  }

  validateConcurrency(): boolean {
    const value = this.formData.concurrency;
    const isValid = Number.isInteger(value) && value >= 0 && value <= 8;
    this.concurrencyError.set(isValid ? '' : this.i18n.t('ai_config.concurrencia_invalida'));
    return isValid;
  }
}
