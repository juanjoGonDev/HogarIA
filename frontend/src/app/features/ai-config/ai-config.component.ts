import { Component, inject, OnInit, signal } from '@angular/core';
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
import { AIProviderConfig, AIProvider } from '../../shared/models/ai-config.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { RouterLink } from '@angular/router';

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
    <div class="ai-config">
      <!-- Header -->
      <div class="ai-config__header">
        <div class="ai-config__title-section">
          <app-icon name="smart_toy" [size]="24" [label]="null" />
          <h1 class="ai-config__title">{{ 'ai_config.configuracion_ia' | t }}</h1>
          <span class="ai-config__count">{{ configuracionesLabel() }}</span>
        </div>
        <app-button variant="primary" (onClick)="openAddModal()">
          <app-icon name="add" [size]="18" [label]="null" />
          {{ 'ai_config.agregar_configuracion' | t }}
        </app-button>
      </div>

      <!-- Info -->
      <div class="ai-config__info">
        <p>{{ 'ai_config.conecta_tu_proveedor_de' | t }}</p>
      </div>

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
              [loading]="probandoId() === config.id"
              (onClick)="testConfig(config)"
              [attr.data-test]="'probar-' + config.name"
            >
              <app-icon name="link" [size]="16" [label]="null" />
              {{ (probandoId() === config.id ? 'ai_config.comprobando' : 'ai_config.probar') | t }}
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
            [required]="true"
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
  private readonly i18n = inject(I18nService);

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
    if (!data.apiKey && this.editingConfig()) {
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
        // La lista local no sabe que el server ha apagado las DEMAS configuraciones al crear
        // (o activar) esta: sin releerla, dos tarjetas dirian «Activo» a la vez.
        this.aiService.loadConfigs();
      },
      error: () => {
        this.notifySaveError();
        this.isSaving.set(false);
      }
    });
  }

  testConfig(config: AIProviderConfig): void {
    if (this.probandoId() || this.probandoForm()) return;
    this.probandoId.set(config.id);

    this.aiService.testConnection({ configId: config.id }).subscribe({
      next: (result) => {
        this.probandoId.set(null);
        if (result) this.aiService.loadConfigs();
        this.testResult.set(
          result ?? { success: false, error: this.i18n.t('ai_config.no_se_pudo_conectar') }
        );
        this.isTestResultOpen.set(true);
      },
      error: () => {
        this.probandoId.set(null);
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
    if (this.probandoForm() || this.probandoId()) return;
    const { baseUrl, apiKey, model, timeout } = this.formData;
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      this.toastService.warning(
        this.i18n.t('ai_config.test'),
        this.i18n.t('ai_config.faltan_datos_para_probar')
      );
      return;
    }

    this.probandoForm.set(true);
    this.aiService
      .testConnection({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        timeout
      })
      .subscribe({
        next: (result) => {
          this.probandoForm.set(false);
          this.testResult.set(
            result ?? { success: false, error: this.i18n.t('ai_config.no_se_pudo_conectar') }
          );
          this.isTestResultOpen.set(true);
        },
        error: () => {
          this.probandoForm.set(false);
          this.testResult.set({
            success: false,
            error: this.i18n.t('ai_config.no_se_pudo_conectar')
          });
          this.isTestResultOpen.set(true);
        }
      });
  }

  toggleActive(config: AIProviderConfig): void {
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
          // Activar es exclusivo: el server ha apagado las DEMAS configuraciones de la casa, y
          // la lista local solo conoce el cambio de esta. Se relee —dos tarjetas con «Activo» a
          // la vez es una mentira que se ve.
          this.aiService.loadConfigs();
        }
      });
  }

  async deleteConfig(config: AIProviderConfig): Promise<void> {
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('ai_config.eliminar_configuracion'),
      message: this.i18n.t('ai_config.eliminar_la_configuracion', { name: config.name }),
      confirmText: this.i18n.t('common.delete')
    });
    if (!accepted) return;

    this.aiService.deleteConfig(config.id).subscribe({
      next: (deleted) => {
        if (!deleted) {
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('ai_config.no_se_pudo_eliminar')
          );
          return;
        }
        this.toastService.success(
          this.i18n.t('ai_config.eliminada'),
          this.i18n.t('ai_config.configuracion_eliminada_correctamente')
        );
      }
    });
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
      default:
        return this.i18n.t('ai_config.pendiente');
    }
  }

  closeTestResult(): void {
    this.isTestResultOpen.set(false);
  }

  private notifySaveError(): void {
    this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('ai_config.no_se_pudo_guardar'));
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
