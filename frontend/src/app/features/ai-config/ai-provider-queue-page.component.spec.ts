import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AiProviderQueuePageComponent } from './ai-provider-queue-page.component';
import { AiQueueService } from '../../core/services/ai-queue.service';
import { AiService } from '../../core/services/ai.service';
import { I18nService } from '../../core/services/i18n.service';
import type { AIProviderConfig } from '../../shared/models/ai-config.model';
import type { AiQueueState } from '../../shared/models/ai-queue.model';

const CONFIG: AIProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  provider: 'custom',
  baseUrl: 'http://localhost:8000/v1',
  apiKey: 'synthetic-only',
  model: 'test-model',
  temperature: 0.7,
  maxTokens: 2000,
  timeout: 30000,
  retryAttempts: 1,
  concurrency: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

type AiServiceTestDouble = {
  configs: WritableSignal<AIProviderConfig[]>;
  configsLoading: WritableSignal<boolean>;
  configsError: WritableSignal<boolean>;
  loadConfigs: jasmine.Spy;
};

describe('AiProviderQueuePageComponent', () => {
  let harness: RouterTestingHarness;
  let configs: WritableSignal<AIProviderConfig[]>;
  let aiService: AiServiceTestDouble;
  let queueService: jasmine.SpyObj<AiQueueService>;

  beforeEach(async () => {
    configs = signal([CONFIG]);
    aiService = {
      configs,
      configsLoading: signal(false),
      configsError: signal(false),
      loadConfigs: jasmine.createSpy('loadConfigs')
    };
    const state = signal<AiQueueState>({
      snapshot: null,
      loading: false,
      loadError: false,
      mutating: false,
      actionError: false
    });
    queueService = jasmine.createSpyObj<AiQueueService>('AiQueueService', [
      'stateFor',
      'watch',
      'refreshQueue',
      'reorder',
      'cancel',
      'retry'
    ]);
    queueService.stateFor.and.returnValue(state.asReadonly());
    queueService.watch.and.returnValue(() => undefined);
    queueService.refreshQueue.and.returnValue(of(null));
    queueService.reorder.and.returnValue(of(true));
    queueService.cancel.and.returnValue(of(true));
    queueService.retry.and.returnValue(of(true));

    await TestBed.configureTestingModule({
      imports: [AiProviderQueuePageComponent],
      providers: [
        provideRouter([
          { path: 'ai-config/:configId/queue', component: AiProviderQueuePageComponent },
          { path: 'ai-config/queue', component: AiProviderQueuePageComponent }
        ]),
        { provide: AiService, useValue: aiService },
        { provide: AiQueueService, useValue: queueService },
        { provide: I18nService, useValue: { changeTick: signal(0), t: (key: string) => key } }
      ]
    }).compileComponents();
    harness = await RouterTestingHarness.create();
  });

  it('loads and mounts only the selected provider queue on its dedicated route', async () => {
    const page = await harness.navigateByUrl(
      `/ai-config/${CONFIG.id}/queue`,
      AiProviderQueuePageComponent
    );

    expect(aiService.loadConfigs).toHaveBeenCalledTimes(1);
    expect(page.provider()).toEqual(CONFIG);
    expect(queueService.watch).toHaveBeenCalledOnceWith(CONFIG.id);
    expect(
      harness.routeNativeElement?.querySelector('[data-test="ai-provider-queue"]')
    ).not.toBeNull();
    expect(
      harness.routeNativeElement
        ?.querySelector('[data-test="queue-back-link"]')
        ?.getAttribute('href')
    ).toBe('/ai-config');
  });

  it('does not mount a queue for an unlimited or unavailable provider', async () => {
    configs.set([{ ...CONFIG, concurrency: 0 }]);
    await harness.navigateByUrl(`/ai-config/${CONFIG.id}/queue`, AiProviderQueuePageComponent);
    expect(queueService.watch).not.toHaveBeenCalled();
    expect(harness.routeNativeElement?.querySelector('[data-test="ai-provider-queue"]')).toBeNull();

    configs.set([]);
    await harness.navigateByUrl('/ai-config/not-owned/queue', AiProviderQueuePageComponent);
    expect(queueService.watch).not.toHaveBeenCalled();
    expect(harness.routeNativeElement?.querySelector('[data-test="ai-provider-queue"]')).toBeNull();
  });

  it('shows not found and does not watch a queue when route params omit configId', async () => {
    const page = await harness.navigateByUrl('/ai-config/queue', AiProviderQueuePageComponent);

    expect(aiService.loadConfigs).toHaveBeenCalledTimes(1);
    expect(page.provider()).toBeUndefined();
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(
      'ai_config.queue_provider_not_found'
    );
    expect(queueService.watch).not.toHaveBeenCalled();
  });

  it('shows loading and load-error states without exposing a queue', async () => {
    configs.set([]);
    aiService.configsLoading.set(true);
    await harness.navigateByUrl('/ai-config/not-owned/queue', AiProviderQueuePageComponent);
    expect(harness.routeNativeElement?.textContent).toContain('ai_config.queue_page_loading');
    expect(queueService.watch).not.toHaveBeenCalled();

    aiService.configsLoading.set(false);
    aiService.configsError.set(true);
    await harness.navigateByUrl('/ai-config/not-owned/queue', AiProviderQueuePageComponent);
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')).not.toBeNull();
    expect(queueService.watch).not.toHaveBeenCalled();
  });
});
