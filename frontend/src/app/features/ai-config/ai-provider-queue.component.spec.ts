import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AiProviderQueueComponent } from './ai-provider-queue.component';
import { AiQueueService } from '../../core/services/ai-queue.service';
import { I18nService } from '../../core/services/i18n.service';
import { aiConfigEn, aiConfigEs } from '../../core/i18n/dict/ai_config';
import type { AIProviderConfig } from '../../shared/models/ai-config.model';
import type { AiQueueJob, AiQueueSnapshot, AiQueueState } from '../../shared/models/ai-queue.model';

const CONFIG = { id: 'provider-a', name: 'Provider A', concurrency: 2 } as AIProviderConfig;

function job(
  id: string,
  status: AiQueueJob['status'],
  queueOrder = 0,
  kind = 'recipe'
): AiQueueJob {
  return {
    id,
    configId: CONFIG.id,
    kind,
    status,
    attempts: status === 'failed' ? 3 : 0,
    maxAttempts: 3,
    error: status === 'failed' ? 'Provider unavailable' : null,
    retryable: status === 'failed',
    createdAt: '2026-10-01T12:00:00.000Z',
    queueOrder
  };
}

function state(snapshot: AiQueueSnapshot | null = null): AiQueueState {
  return { snapshot, loading: false, loadError: false, mutating: false, actionError: false };
}

function stubClipboard(writeText: jasmine.Spy): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  });
  return () => {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  };
}

describe('AiProviderQueueComponent', () => {
  let fixture: ComponentFixture<AiProviderQueueComponent>;
  let component: AiProviderQueueComponent;
  let queueService: jasmine.SpyObj<AiQueueService>;
  let queueState: ReturnType<typeof signal<AiQueueState>>;
  let stopWatching: jasmine.Spy;

  const i18n = {
    changeTick: signal(0),
    t: (key: string, params?: Record<string, unknown>) => {
      let text = key;
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value ?? ''));
      }
      return text;
    }
  };

  beforeEach(async () => {
    queueState = signal(state());
    stopWatching = jasmine.createSpy('stopWatching');
    queueService = jasmine.createSpyObj<AiQueueService>('AiQueueService', [
      'stateFor',
      'watch',
      'refreshQueue',
      'reorder',
      'cancel',
      'retry'
    ]);
    queueService.stateFor.and.returnValue(queueState.asReadonly());
    queueService.watch.and.returnValue(stopWatching);
    queueService.refreshQueue.and.returnValue(of(null));
    queueService.reorder.and.returnValue(of(true));
    queueService.cancel.and.returnValue(of(true));
    queueService.retry.and.returnValue(of(true));

    await TestBed.configureTestingModule({
      imports: [AiProviderQueueComponent],
      providers: [
        { provide: AiQueueService, useValue: queueService },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AiProviderQueueComponent);
    component = fixture.componentInstance;
  });

  it('defines the diagnostic action and status messages in Spanish and English', () => {
    expect(aiConfigEs['ai_config.queue_copy_diagnostic']).toBe('Copiar diagnóstico');
    expect(aiConfigEs['ai_config.queue_copy_diagnostic_job']).toContain('{job}');
    expect(aiConfigEs['ai_config.queue_copy_diagnostic_success']).toBe('Diagnóstico copiado.');
    expect(aiConfigEn['ai_config.queue_copy_diagnostic']).toBe('Copy diagnostics');
    expect(aiConfigEn['ai_config.queue_copy_diagnostic_job']).toContain('{job}');
    expect(aiConfigEn['ai_config.queue_copy_diagnostic_success']).toBe('Diagnostics copied.');
  });

  it('only mounts and polls for a provider with a positive cap', () => {
    fixture.componentRef.setInput('config', { ...CONFIG, concurrency: 0 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="ai-provider-queue"]')).toBeNull();
    expect(queueService.watch).not.toHaveBeenCalled();

    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="ai-provider-queue"]')).not.toBeNull();
    expect(queueService.watch).toHaveBeenCalledOnceWith(CONFIG.id);
    fixture.destroy();
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it('groups queued, running, and terminal failures and uses neutral text for unknown kinds', () => {
    queueState.set(
      state({
        configId: CONFIG.id,
        jobs: [
          job('waiting', 'queued', 0, 'recipe'),
          job('running', 'running', 1),
          job('failed', 'failed', 2, 'untrusted-private-value')
        ]
      })
    );
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-test="ai-queue-job-queued"]').length).toBe(
      1
    );
    expect(
      fixture.nativeElement.querySelectorAll('[data-test="ai-queue-job-running"]').length
    ).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('[data-test="ai-queue-job-failed"]').length).toBe(
      1
    );
    expect(fixture.nativeElement.textContent).toContain('ai_config.queue_kind_recipe');
    expect(fixture.nativeElement.textContent).toContain('ai_config.queue_kind_unknown');
    expect(fixture.nativeElement.textContent).not.toContain('untrusted-private-value');
    expect(
      fixture.nativeElement.querySelectorAll('button[data-action="copy-diagnostic"]').length
    ).toBe(3);
    expect(
      fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]')
    ).not.toBeNull();
  });

  it('copies diagnostics only for the selected job and omits untrusted or sensitive metadata', async () => {
    const selected = {
      ...job('selected-job', 'failed', 0, 'connection_test'),
      error: 'PROVIDER',
      providerResponseId: 'resp_synthetic123',
      providerTransport: 'responses_background',
      providerHttpStatus: 499,
      elapsedMs: 30_000,
      diagnosticStage: 'polling',
      apiKey: 'synthetic-secret-sentinel',
      baseUrl: 'https://private.invalid/v1',
      prompt: 'private prompt sentinel',
      output: 'private output sentinel'
    } as unknown as AiQueueJob;
    const other = job('other-job', 'queued', 1);
    queueState.set(state({ configId: CONFIG.id, jobs: [selected, other] }));
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    const restoreClipboard = stubClipboard(writeText);
    try {
      const copyButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        'button[data-action="copy-diagnostic"][data-job-id="selected-job"]'
      );
      expect(copyButton?.getAttribute('aria-label')).toBe('ai_config.queue_copy_diagnostic_job');
      expect(copyButton?.textContent).toContain('ai_config.queue_copy_diagnostic');
      await component.copyDiagnostic(selected);
      fixture.detectChanges();

      expect(writeText).toHaveBeenCalledOnceWith(jasmine.any(String));
      const copied = writeText.calls.argsFor(0)[0] as string;
      const diagnostic = JSON.parse(copied) as Record<string, unknown>;
      expect(diagnostic).toEqual({
        jobId: 'selected-job',
        kind: 'connection_test',
        status: 'failed',
        attempts: 3,
        maxAttempts: 3,
        createdAt: '2026-10-01T12:00:00.000Z',
        error: 'PROVIDER',
        providerResponseId: 'resp_synthetic123',
        providerTransport: 'responses_background',
        providerHttpStatus: 499,
        elapsedMs: 30_000,
        diagnosticStage: 'polling'
      });
      expect(copied).not.toContain('other-job');
      expect(copied).not.toContain('synthetic-secret-sentinel');
      expect(copied).not.toContain('private.invalid');
      expect(copied).not.toContain('private prompt sentinel');
      expect(copied).not.toContain('private output sentinel');
      expect(component.diagnosticCopyStatus()).toBe('copied');
      expect(component.announcement()).toBe('ai_config.queue_copy_diagnostic_success');
    } finally {
      restoreClipboard();
    }
  });

  it('rejects unsafe provider metadata and announces clipboard permission failures', async () => {
    const selected = {
      ...job('selected-job', 'failed', 0, 'unknown-private-kind'),
      error: 'unsafe provider error detail',
      providerResponseId: 'https://credential.invalid/secret',
      providerTransport: 'untrusted-private-value',
      providerHttpStatus: 700,
      elapsedMs: -1,
      diagnosticStage: 'untrusted-private-value'
    } as unknown as AiQueueJob;
    queueState.set(state({ configId: CONFIG.id, jobs: [selected] }));
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    const writeText = jasmine
      .createSpy('writeText')
      .and.returnValue(Promise.reject(new Error('Permission denied')));
    const restoreClipboard = stubClipboard(writeText);
    try {
      await component.copyDiagnostic(selected);
      fixture.detectChanges();

      const copied = writeText.calls.argsFor(0)[0] as string;
      const diagnostic = JSON.parse(copied) as Record<string, unknown>;
      expect(diagnostic['kind']).toBe('unknown');
      expect(diagnostic['error']).toBeNull();
      expect(diagnostic['providerResponseId']).toBeUndefined();
      expect(diagnostic['providerTransport']).toBeUndefined();
      expect(diagnostic['providerHttpStatus']).toBeUndefined();
      expect(diagnostic['elapsedMs']).toBeUndefined();
      expect(diagnostic['diagnosticStage']).toBeUndefined();
      expect(copied).not.toContain('credential.invalid');
      expect(copied).not.toContain('untrusted-private-value');
      expect(copied).not.toContain('unsafe provider error detail');
      expect(component.diagnosticCopyStatus()).toBe('failed');
      expect(component.announcement()).toBe('ai_config.queue_copy_diagnostic_failed');
      expect(fixture.nativeElement.textContent).toContain('ai_config.queue_copy_diagnostic_failed');
    } finally {
      restoreClipboard();
    }
  });

  it('localizes allowlisted backend errors and hides retry when the job input is unavailable', () => {
    const nonRetryable = { ...job('expired', 'failed'), retryable: false, error: 'INPUT_EXPIRED' };
    const retryable = { ...job('retryable', 'failed'), error: 'TIMEOUT' };
    queueState.set(state({ configId: CONFIG.id, jobs: [nonRetryable, retryable] }));
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    expect(component.errorLabel('PROVIDER')).toBe('ai_config.queue_error_provider');
    expect(component.errorLabel('BAD_JSON')).toBe('ai_config.queue_error_bad_json');
    expect(component.errorLabel('TIMEOUT')).toBe('ai_config.queue_error_timeout');
    expect(component.errorLabel('INPUT_EXPIRED')).toBe('ai_config.queue_error_input_expired');
    expect(component.errorLabel('CONFIG_UNAVAILABLE')).toBe(
      'ai_config.queue_error_config_unavailable'
    );
    expect(component.errorLabel('UNSAFE_BACKEND_DETAIL')).toBe('ai_config.queue_error_unknown');
    expect(fixture.nativeElement.textContent).not.toContain('UNSAFE_BACKEND_DETAIL');
    expect(
      fixture.nativeElement.querySelectorAll(
        '.ai-queue__action-button--retry[data-job-id="expired"]'
      )
    ).toHaveSize(0);
    expect(
      fixture.nativeElement.querySelectorAll(
        '.ai-queue__action-button--retry[data-job-id="retryable"]'
      )
    ).toHaveSize(1);
  });

  it('uses keyboard/touch move controls and persists only the queued order', () => {
    queueState.set(
      state({ configId: CONFIG.id, jobs: [job('one', 'queued', 0), job('two', 'queued', 1)] })
    );
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    const down = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-action="move-down"][data-job-id="one"]'
    );
    expect(down).not.toBeNull();
    expect(down!.getAttribute('aria-label')).toBe('ai_config.queue_move_down');
    expect(down!.getAttribute('data-job-id')).toBe('one');
    down!.click();

    expect(queueService.reorder).toHaveBeenCalledOnceWith(CONFIG.id, ['two', 'one']);
  });

  it('supports pointer drag/drop to another waiting item and ignores a no-op drop', () => {
    const first = job('one', 'queued', 0);
    const second = job('two', 'queued', 1);
    queueState.set(state({ configId: CONFIG.id, jobs: [first, second] }));
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: jasmine.createSpy('setData'),
      getData: jasmine.createSpy('getData').and.returnValue('one')
    } as unknown as DataTransfer;
    const event = {
      dataTransfer,
      preventDefault: jasmine.createSpy('preventDefault')
    } as unknown as DragEvent;
    component.startDrag(event, first);
    component.dropJob(event, second);
    expect(queueService.reorder).toHaveBeenCalledOnceWith(CONFIG.id, ['two', 'one']);

    queueService.reorder.calls.reset();
    component.dropJob(event, first);
    expect(queueService.reorder).not.toHaveBeenCalled();
  });

  it('cancels queued/running work and retries failed work with live feedback', () => {
    const waiting = job('waiting', 'queued');
    const running = job('running', 'running');
    const failed = job('failed', 'failed');
    queueState.set(state({ configId: CONFIG.id, jobs: [waiting, running, failed] }));
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    component.cancel(waiting);
    component.cancel(running);
    component.retry(failed);

    expect(queueService.cancel).toHaveBeenCalledWith(CONFIG.id, 'waiting');
    expect(queueService.cancel).toHaveBeenCalledWith(CONFIG.id, 'running');
    expect(queueService.retry).toHaveBeenCalledWith(CONFIG.id, 'failed');
    expect(component.announcement()).toBe('ai_config.queue_retried');
  });

  it('offers retry after loading failures and announces action errors accessibly', () => {
    queueState.set({ ...state(), loadError: true, actionError: true });
    fixture.componentRef.setInput('config', CONFIG);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-queue-action-error"]')
    ).not.toBeNull();
    fixture.nativeElement.querySelector('.ai-queue__text-button').click();
    expect(queueService.refreshQueue).toHaveBeenCalledWith(CONFIG.id);
  });
});
