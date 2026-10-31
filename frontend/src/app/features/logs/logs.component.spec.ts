import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { LogEntry, LogService } from '../../core/services/log.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { LogsComponent } from './logs.component';

const ENTRIES: LogEntry[] = [
  {
    id: 'error-1',
    timestamp: '2026-10-01T12:00:00.000Z',
    level: 'error',
    source: 'server',
    message: 'synthetic error',
    stack: 'synthetic stack'
  },
  {
    id: 'warn-1',
    timestamp: '2026-10-01T12:01:00.000Z',
    level: 'warn',
    source: 'server',
    message: 'synthetic warning'
  },
  {
    id: 'info-1',
    timestamp: '2026-10-01T12:02:00.000Z',
    level: 'info',
    source: 'browser',
    message: 'synthetic information'
  }
];

describe('LogsComponent', () => {
  let fixture: ComponentFixture<LogsComponent>;
  let component: LogsComponent;
  let logService: any;
  let toastService: jasmine.SpyObj<ToastService>;
  let confirmService: jasmine.SpyObj<ConfirmService>;
  let i18n: { changeTick: ReturnType<typeof signal<number>>; t: jasmine.Spy };
  let http: HttpTestingController;

  beforeEach(async () => {
    logService = {
      logs: signal<LogEntry[]>([...ENTRIES]),
      connected: signal(false),
      streamStatus: signal<'live' | 'connecting' | 'retrying' | 'closed'>('closed'),
      retryIn: signal<number | null>(null),
      autoScroll: signal(true),
      paused: signal(false),
      sourceFilter: signal('all'),
      levelFilter: signal('all'),
      onlyErrors: signal(false),
      isVisible: jasmine.createSpy('isVisible').and.returnValue(true),
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      setSourceFilter: jasmine.createSpy('setSourceFilter'),
      setLevelFilter: jasmine.createSpy('setLevelFilter'),
      setOnlyErrors: jasmine.createSpy('setOnlyErrors'),
      togglePause: jasmine.createSpy('togglePause'),
      toggleAutoScroll: jasmine.createSpy('toggleAutoScroll'),
      clear: jasmine.createSpy('clear').and.returnValue(of({}))
    };
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['info', 'success', 'error']);
    confirmService = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    i18n = {
      changeTick: signal(0),
      t: jasmine.createSpy('translate').and.callFake((key: string) => key)
    };

    await TestBed.configureTestingModule({
      imports: [LogsComponent],
      providers: [
        { provide: LogService, useValue: logService },
        { provide: ToastService, useValue: toastService },
        { provide: ConfirmService, useValue: confirmService },
        { provide: I18nService, useValue: i18n },
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LogsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/health').flush({
      status: 'ok',
      uptime: 93784,
      version: '1.0.0',
      imageRevision: '0123456789abcdef0123456789abcdef01234567'
    });
    fixture.detectChanges();
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('shows server uptime and GHCR revision from the health endpoint', () => {
    const runtime = fixture.nativeElement.querySelector('[data-test="logs-runtime"]');
    expect(runtime.textContent).toContain('logs.runtime_uptime_label');
    expect(runtime.textContent).toContain('1d 2h 3m 4s');
    expect(runtime.textContent).toContain('logs.runtime_image_revision_label');
    expect(runtime.textContent).toContain('0123456789abcdef0123456789abcdef01234567');
  });

  it('announces loading and exposes a retry when runtime metadata cannot load', () => {
    component.loadRuntimeMetadata();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="logs-runtime-loading"]')).toBeTruthy();

    http
      .expectOne('/health')
      .flush({ message: 'synthetic failure' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'logs.runtime_unavailable'
    );

    const retry = fixture.nativeElement.querySelector(
      '[data-test="logs-runtime-retry"]'
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();
    retry.querySelector('button')?.click();
    fixture.detectChanges();
    http.expectOne('/health').flush({
      status: 'ok',
      uptime: 60,
      version: '1.0.0',
      imageRevision: 'dev'
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="logs-runtime"]')?.textContent
    ).toContain('dev');
  });

  it('does not overlap health requests and rejects malformed metadata', () => {
    component.loadRuntimeMetadata();
    component.loadRuntimeMetadata();
    expect(component.runtimeLoading()).toBeTrue();

    http.expectOne('/health').flush({ uptime: 'not-a-number', imageRevision: '' });
    fixture.detectChanges();

    expect(component.runtimeLoading()).toBeFalse();
    expect(component.runtimeError()).toBeTrue();
    expect(component.runtimeInfo()?.imageRevision).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('formats non-negative uptime into readable day/hour/minute/second units', () => {
    expect(component.formatUptime(93784)).toBe('1d 2h 3m 4s');
    expect(component.formatUptime(3661)).toBe('1h 1m 1s');
    expect(component.formatUptime(-2)).toBe('0s');
    expect(component.formatUptime(Number.NaN)).toBe('0s');
  });

  it('connects, exposes localized filter names, forwards selections, and reconnects on request', () => {
    expect(logService.connect).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement.querySelector('[aria-label="logs.fuente_filtro_label"]')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="logs.nivel_filtro_label"]')
    ).not.toBeNull();

    component.onSourceChange('browser');
    component.onLevelChange('error');
    component.reconnect();
    expect(logService.setSourceFilter).toHaveBeenCalledOnceWith('browser');
    expect(logService.setLevelFilter).toHaveBeenCalledOnceWith('error');
    expect(logService.connect).toHaveBeenCalledTimes(2);
  });

  it('renders the accessible only-errors checkbox and forwards its value', () => {
    const checkbox = fixture.nativeElement.querySelector(
      '.logs-only-errors input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBeFalse();
    expect(checkbox.closest('label')?.textContent).toContain('logs.solo_errores');

    checkbox.click();
    expect(logService.setOnlyErrors).toHaveBeenCalledOnceWith(true);

    logService.onlyErrors.set(true);
    fixture.detectChanges();
    expect(checkbox.checked).toBeTrue();
  });

  it('keeps the selected log when confirmation is declined or the DELETE fails', async () => {
    component.onLineClick(new MouseEvent('click'), ENTRIES[0], 0);
    confirmService.confirm.and.returnValue(Promise.resolve(false));
    await component.clearLogs();
    expect(logService.clear).not.toHaveBeenCalled();
    expect(component.isSelected(ENTRIES[0])).toBeTrue();

    confirmService.confirm.and.returnValue(Promise.resolve(true));
    logService.clear.and.returnValue(
      throwError(() => new Error('synthetic 503')) as Observable<unknown>
    );
    await component.clearLogs();
    expect(logService.clear).toHaveBeenCalledTimes(1);
    expect(component.isSelected(ENTRIES[0])).toBeTrue();
  });

  it('clears selection only after the server acknowledges deletion', async () => {
    component.onLineClick(new MouseEvent('click'), ENTRIES[0], 0);
    confirmService.confirm.and.returnValue(Promise.resolve(true));
    logService.clear.and.returnValue(of({ success: true }));

    await component.clearLogs();

    expect(component.hasSelection()).toBeFalse();
    expect(logService.clear).toHaveBeenCalledTimes(1);
  });

  it('covers normal, additive, range, and browser-text selection interactions', () => {
    component.onLineMouseDown(new MouseEvent('mousedown', { shiftKey: true }));
    component.onLineClick(new MouseEvent('click'), ENTRIES[0], 0);
    expect(component.isSelected(ENTRIES[0])).toBeTrue();
    component.onLineClick(new MouseEvent('click'), ENTRIES[0], 0);
    expect(component.hasSelection()).toBeFalse();

    component.onLineClick(new MouseEvent('click', { ctrlKey: true }), ENTRIES[0], 0);
    component.onLineClick(new MouseEvent('click', { metaKey: true }), ENTRIES[1], 1);
    expect(component.selectedCount()).toBe(2);
    component.onLineClick(new MouseEvent('click', { ctrlKey: true }), ENTRIES[1], 1);
    expect(component.selectedCount()).toBe(1);

    component.clearSelection();
    component.onLineClick(new MouseEvent('click'), ENTRIES[0], 0);
    component.onLineClick(new MouseEvent('click', { shiftKey: true }), ENTRIES[2], 2);
    expect(component.selectedCount()).toBe(3);
    component.clearSelection();
    component.onLineClick(new MouseEvent('click', { shiftKey: true }), ENTRIES[2], 2);
    expect(component.selectedCount()).toBe(1);

    spyOn(window, 'getSelection').and.returnValue({ isCollapsed: false } as Selection);
    component.onLineClick(new MouseEvent('click'), ENTRIES[1], 1);
    expect(component.isSelected(ENTRIES[2])).toBeTrue();
    expect(component.isSelected(ENTRIES[1])).toBeFalse();
  });

  it('formats entries and reports each transport state', () => {
    expect(component.keyOf(ENTRIES[0])).toBe('error-1');
    expect(component.trackByEntry(0, ENTRIES[0])).toBe('error-1');
    expect(component.formatEntry(ENTRIES[0])).toContain(
      '[SRV] ERROR synthetic error\nsynthetic stack'
    );
    expect(component.levelTag('warning')).toBe('WARNI');
    expect(component.formatTime(ENTRIES[0].timestamp)).toBeTruthy();
    expect(component.clientZone()).toBeTruthy();

    logService.streamStatus.set('live');
    expect(component.statusLabel()).toBe('logs.estado_en_vivo');
    logService.streamStatus.set('connecting');
    expect(component.statusLabel()).toBe('logs.estado_conectando');
    logService.streamStatus.set('retrying');
    logService.retryIn.set(2400);
    expect(component.statusLabel()).toBe('logs.estado_reintentando_en');
    logService.retryIn.set(null);
    expect(component.statusLabel()).toBe('logs.estado_reintentando');
    logService.streamStatus.set('closed');
    expect(component.statusLabel()).toBe('logs.estado_sinConexion');
  });

  it('shows an informational toast for empty copy and success/error for clipboard outcomes', async () => {
    logService.logs.set([]);
    fixture.detectChanges();
    component.copyVisible();
    expect(toastService.info).toHaveBeenCalled();

    logService.logs.set([...ENTRIES]);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jasmine.createSpy('writeText').and.returnValue(Promise.resolve()) }
    });
    component.copyVisible();
    await Promise.resolve();
    await Promise.resolve();
    expect(toastService.success).toHaveBeenCalled();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jasmine.createSpy('writeText').and.returnValue(Promise.reject()) }
    });
    component.copyVisible();
    await Promise.resolve();
    await Promise.resolve();
    expect(toastService.error).toHaveBeenCalled();
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('does not report success when the legacy clipboard fallback rejects the copy command', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    spyOn(document, 'execCommand').and.returnValue(false);

    try {
      component.copyVisible();
      await Promise.resolve();
      await Promise.resolve();

      expect(toastService.success).not.toHaveBeenCalled();
      expect(toastService.error).toHaveBeenCalledWith('ui.error', 'logs.no_se_pudo_copiar');
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }
  });

  it('scrolls only when enabled and disconnects on destroy', () => {
    const body = fixture.nativeElement.querySelector('.terminal__body') as HTMLElement;
    spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    logService.logs.set([...ENTRIES, { ...ENTRIES[0], id: 'later-error' }]);
    (window.requestAnimationFrame as jasmine.Spy).calls.reset();
    component.ngAfterViewChecked();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(body.scrollHeight).toBeGreaterThan(0);

    logService.autoScroll.set(false);
    logService.logs.set([]);
    (window.requestAnimationFrame as jasmine.Spy).calls.reset();
    component.ngAfterViewChecked();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    component.bodyEl = undefined as any;
    component.ngAfterViewChecked();
    fixture.destroy();
    expect(logService.disconnect).toHaveBeenCalledTimes(1);
  });
});
