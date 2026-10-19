import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AiConfigComponent } from './ai-config.component';
import { AiService } from '../../core/services/ai.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import type { AIProviderConfig } from '../../shared/models/ai-config.model';
import { aiConfigEn, aiConfigEs } from '../../core/i18n/dict/ai_config';

const CONFIG: AIProviderConfig = {
  id: 'synthetic-config',
  name: 'Synthetic provider',
  provider: 'custom',
  baseUrl: 'http://localhost:8000/v1',
  apiKey: 'sk-synthetic-only',
  model: 'gpt-test',
  temperature: 0.7,
  maxTokens: 2000,
  timeout: 30000,
  retryAttempts: 3,
  concurrency: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

describe('AiConfigComponent', () => {
  let fixture: ComponentFixture<AiConfigComponent>;
  let component: AiConfigComponent;
  let service: ReturnType<typeof createAiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let confirm: jasmine.SpyObj<ConfirmService>;

  function createAiService() {
    return {
      configs: signal<AIProviderConfig[]>([]),
      configsLoading: signal(false),
      configsError: signal(false),
      loadConfigs: jasmine.createSpy('loadConfigs'),
      createConfig: jasmine.createSpy('createConfig').and.returnValue(of(CONFIG)),
      updateConfig: jasmine.createSpy('updateConfig').and.returnValue(of(CONFIG)),
      deleteConfig: jasmine.createSpy('deleteConfig').and.returnValue(of(true)),
      testConnection: jasmine
        .createSpy('testConnection')
        .and.returnValue(of({ success: true, model: 'gpt-test', latency: 12 }))
    };
  }

  const i18n = {
    changeTick: signal(0),
    t: (key: string) => key,
    plural: (count: number, singular: string, plural: string) => (count === 1 ? singular : plural)
  };

  beforeEach(async () => {
    service = createAiService();
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warning']);
    confirm = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirm.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [AiConfigComponent],
      providers: [
        { provide: AiService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: ConfirmService, useValue: confirm },
        { provide: I18nService, useValue: i18n },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AiConfigComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads configurations on entry and pluralizes the counter', () => {
    expect(service.loadConfigs).toHaveBeenCalledTimes(1);
    expect(component.configuracionesLabel()).toBe('ai_config.n_configuraciones_varios');
    service.configs.set([CONFIG]);
    expect(component.configuracionesLabel()).toBe('ai_config.n_configuraciones_uno');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.config-card__name')?.textContent).toContain(
      CONFIG.name
    );
  });

  it('starts new provider configs with enough output budget for all recipe detail levels', () => {
    component.openAddModal();
    fixture.detectChanges();

    expect(component.formData.maxTokens).toBe(4096);
    const input = fixture.nativeElement.querySelector('input#maxTokens') as HTMLInputElement | null;
    expect(input?.value).toBe('4096');

    component.formData = {
      ...component.formData,
      name: 'New provider',
      baseUrl: CONFIG.baseUrl,
      apiKey: 'synthetic-key',
      model: 'gpt-5'
    };
    component.saveConfig();
    expect(service.createConfig).toHaveBeenCalledWith(
      jasmine.objectContaining({ maxTokens: 4096 })
    );
  });

  it('keeps queue panels out of the provider list and links only positive caps to their own view', () => {
    service.configs.set([
      CONFIG,
      { ...CONFIG, id: 'unlimited-provider', concurrency: 0, name: 'Unlimited provider' }
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-test="ai-provider-queue"]').length).toBe(
      0
    );
    const links = fixture.nativeElement.querySelectorAll('[data-test="ai-queue-link"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toContain(`/ai-config/${CONFIG.id}/queue`);
  });

  it('separates loading and failure from the confirmed empty state', () => {
    service.configsLoading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ai-config__loading')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();

    service.configsLoading.set(false);
    service.configsError.set(true);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.ai-config__load-error')?.getAttribute('role')
    ).toBe('alert');
    expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();
  });

  it('resets on add and masks an existing API key on edit', () => {
    component.formData.name = 'dirty';
    component.openAddModal();
    expect(component.isModalOpen()).toBeTrue();
    expect(component.formData.name).toBe('');

    component.editConfig(CONFIG);
    expect(component.editingConfig()).toBe(CONFIG);
    expect(component.formData.apiKey).toBe('');
    expect(component.formData.name).toBe(CONFIG.name);
    component.closeModal();
    expect(component.isModalOpen()).toBeFalse();
    expect(component.editingConfig()).toBeNull();
  });

  it('defaults new providers to unlimited and preserves zero while editing', () => {
    component.openAddModal();
    expect(component.formData.concurrency).toBe(0);

    component.editConfig({ ...CONFIG, concurrency: 0 });
    expect(component.formData.concurrency).toBe(0);
  });

  it('labels the provider-wide limit and explains unlimited mode in Spanish and English', () => {
    expect(aiConfigEs['ai_config.concurrencia']).toBe('Concurrencia máxima');
    expect(aiConfigEs['ai_config.concurrencia_helper']).toContain('0 = ilimitado');
    expect(aiConfigEn['ai_config.concurrencia']).toBe('Maximum concurrency');
    expect(aiConfigEn['ai_config.concurrencia_helper']).toContain('0 = unlimited');
  });

  it('blocks negative, fractional and out-of-range concurrency before saving', () => {
    for (const invalidConcurrency of [-1, 1.5, 9]) {
      component.openAddModal();
      component.formData = {
        ...component.formData,
        name: 'Synthetic provider',
        baseUrl: CONFIG.baseUrl,
        apiKey: 'sk-synthetic-only',
        model: CONFIG.model,
        concurrency: invalidConcurrency
      };

      component.saveConfig();

      expect(service.createConfig).not.toHaveBeenCalled();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#concurrency-error')).not.toBeNull();
    }
  });

  it('creates a config on success and keeps the dialog open when save fails', () => {
    component.openAddModal();
    component.formData = {
      ...component.formData,
      name: 'New provider',
      apiKey: 'sk-synthetic-only'
    };
    component.saveConfig();
    expect(service.createConfig).toHaveBeenCalledWith(
      jasmine.objectContaining({ name: 'New provider' })
    );
    expect(toast.success).toHaveBeenCalled();
    expect(service.loadConfigs).toHaveBeenCalledTimes(2);
    expect(component.isModalOpen()).toBeFalse();
    expect(component.isSaving()).toBeFalse();

    service.createConfig.and.returnValue(of(null));
    component.openAddModal();
    component.formData.name = 'Unpersisted';
    component.saveConfig();
    expect(toast.error).toHaveBeenCalled();
    expect(component.isModalOpen()).toBeTrue();
    expect(component.isSaving()).toBeFalse();
  });

  it('updates without sending a blank API key and reports a failed edit', () => {
    service.configs.set([CONFIG]);
    const updated = { ...CONFIG, name: 'Renamed provider' };
    service.updateConfig.and.returnValue(of(updated));
    component.editConfig(CONFIG);
    component.formData.name = updated.name;
    component.saveConfig();
    const sent = service.updateConfig.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(sent['apiKey']).toBeUndefined();
    expect(sent['name']).toBe(updated.name);
    expect(toast.success).toHaveBeenCalled();

    service.updateConfig.and.returnValue(of(null));
    component.editConfig(CONFIG);
    component.saveConfig();
    expect(toast.error).toHaveBeenCalled();
    expect(component.isModalOpen()).toBeTrue();
  });

  it('validates unsaved test details and displays either provider verdict', () => {
    component.openAddModal();
    component.testFromForm();
    expect(toast.warning).toHaveBeenCalled();
    expect(service.testConnection).not.toHaveBeenCalled();

    component.formData = {
      ...component.formData,
      baseUrl: CONFIG.baseUrl,
      apiKey: CONFIG.apiKey,
      model: CONFIG.model
    };
    service.testConnection.and.returnValue(of({ success: true, model: CONFIG.model, latency: 12 }));
    component.testFromForm();
    expect(component.testResult()).toEqual({ success: true, model: CONFIG.model, latency: 12 });
    expect(component.isTestResultOpen()).toBeTrue();
    expect(component.probandoForm()).toBeFalse();
    component.closeTestResult();
    expect(component.isTestResultOpen()).toBeFalse();

    service.testConnection.and.returnValue(of(null));
    component.testFromForm();
    expect(component.testResult()?.success).toBeFalse();
    expect(component.isTestResultOpen()).toBeTrue();

    service.testConnection.and.returnValue(throwError(() => new Error('synthetic')));
    component.testFromForm();
    expect(component.testResult()?.success).toBeFalse();
    expect(component.probandoForm()).toBeFalse();
  });

  it('serializes saved tests and refreshes the persisted status after a response', () => {
    const pending = new Subject<{ success: boolean; model: string; latency: number }>();
    service.testConnection.and.returnValue(pending);
    component.testConfig(CONFIG);
    expect(component.probandoId()).toBe(CONFIG.id);
    component.testConfig(CONFIG);
    expect(service.testConnection).toHaveBeenCalledTimes(1);

    pending.next({ success: true, model: CONFIG.model, latency: 10 });
    pending.complete();
    expect(component.probandoId()).toBeNull();
    expect(component.isTestResultOpen()).toBeTrue();
    expect(service.loadConfigs).toHaveBeenCalledTimes(2);

    service.testConnection.and.returnValue(of(null));
    component.testConfig(CONFIG);
    expect(component.testResult()?.success).toBeFalse();
    expect(component.isTestResultOpen()).toBeTrue();
  });

  it('handles active toggle and failed update without a false success toast', () => {
    service.updateConfig.and.returnValue(of({ ...CONFIG, isActive: false }));
    component.toggleActive(CONFIG);
    expect(service.updateConfig).toHaveBeenCalledWith(CONFIG.id, { isActive: false });
    expect(toast.success).toHaveBeenCalled();
    expect(service.loadConfigs).toHaveBeenCalledTimes(2);

    service.updateConfig.and.returnValue(of(null));
    component.toggleActive({ ...CONFIG, isActive: false });
    expect(toast.error).toHaveBeenCalled();
  });

  it('requires explicit confirmation before deletion and reports a failed delete', async () => {
    confirm.confirm.and.resolveTo(false);
    await component.deleteConfig(CONFIG);
    expect(service.deleteConfig).not.toHaveBeenCalled();

    confirm.confirm.and.resolveTo(true);
    await component.deleteConfig(CONFIG);
    expect(service.deleteConfig).toHaveBeenCalledWith(CONFIG.id);
    expect(toast.success).toHaveBeenCalled();

    service.deleteConfig.and.returnValue(of(false));
    await component.deleteConfig(CONFIG);
    expect(toast.error).toHaveBeenCalled();
  });

  it('maps every saved test status to a stable label and badge variant', () => {
    expect(component.getTestStatusVariant('success')).toBe('success');
    expect(component.getTestStatusVariant('failed')).toBe('error');
    expect(component.getTestStatusVariant('testing')).toBe('warning');
    expect(component.getTestStatusLabel('success')).toBe('OK');
    expect(component.getTestStatusLabel('failed')).toBe('ui.error');
    expect(component.getTestStatusLabel('testing')).toBe('ai_config.probando');
    expect(component.getTestStatusLabel('idle')).toBe('ai_config.pendiente');
  });
});
