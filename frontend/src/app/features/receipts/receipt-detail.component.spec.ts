import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { ReceiptDetailComponent } from './receipt-detail.component';
import { ReceiptsService } from '../../core/services/receipts.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { ClipboardService } from '../../core/services/clipboard.service';
import type { ReceiptDetail, ReceiptItem, ReceiptJob } from '../../shared/models/receipt.model';

const RECEIPT_ID = 'receipt-test-1';

function makeLine(overrides: Partial<ReceiptItem> = {}): ReceiptItem {
  return {
    id: 'line-1',
    name: 'Leche',
    quantity: 2,
    unit: 'L',
    category: 'dairy',
    priceMinor: 250,
    offer: null,
    note: null,
    confidence: 0.9,
    ...overrides
  };
}

function makeJob(overrides: Partial<ReceiptJob> = {}): ReceiptJob {
  return {
    id: 'job-receipt-17',
    status: 'failed',
    attempts: 4,
    max_attempts: 4,
    error_code: 'PROVIDER',
    created_at: '2026-11-01T17:34:59.000Z',
    ...overrides
  };
}

function makeReceipt(overrides: Partial<ReceiptDetail> = {}): ReceiptDetail {
  return {
    id: RECEIPT_ID,
    status: 'review',
    store: 'Tienda inicial',
    purchaseDate: '2026-08-21',
    currency: 'EUR',
    totalMinor: 250,
    notes: null,
    fileUrl: '/synthetic/receipt.png',
    fileKind: 'png',
    fileName: 'ticket.png',
    error: null,
    warnings: [],
    createdAt: '2026-08-22T10:00:00.000Z',
    updatedAt: '2026-08-22T10:00:00.000Z',
    confirmedAt: null,
    items: 1,
    lines: [makeLine()],
    job: null,
    ...overrides
  };
}

describe('ReceiptDetailComponent', () => {
  let fixture: ComponentFixture<ReceiptDetailComponent>;
  let component: ReceiptDetailComponent;
  let service: ReturnType<typeof createReceiptsService>;
  let categories: ReturnType<typeof signal<Array<{ key: string; name: string; color: string }>>>;
  let pantry: { categories: typeof categories; loadCategories: jasmine.Spy };
  let toast: jasmine.SpyObj<ToastService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let clipboard: jasmine.SpyObj<ClipboardService>;
  let i18n: { changeTick: ReturnType<typeof signal<number>>; t: jasmine.Spy };
  let router: Router;

  function createReceiptsService(receipt: ReceiptDetail | null) {
    return {
      receipt: signal(receipt),
      watch: jasmine.createSpy('watch'),
      unwatch: jasmine.createSpy('unwatch'),
      loadReceipt: jasmine.createSpy('loadReceipt'),
      refreshReceipt: jasmine.createSpy('refreshReceipt').and.returnValue(of(null)),
      updateReceipt: jasmine.createSpy('updateReceipt').and.resolveTo(receipt),
      updateLine: jasmine.createSpy('updateLine').and.resolveTo({ id: 'line-1' }),
      deleteLine: jasmine.createSpy('deleteLine').and.resolveTo(true),
      addLine: jasmine.createSpy('addLine').and.resolveTo({ id: 'line-new' }),
      stopJob: jasmine.createSpy('stopJob').and.resolveTo(true),
      retryJob: jasmine.createSpy('retryJob').and.resolveTo(true),
      deleteReceipt: jasmine.createSpy('deleteReceipt').and.resolveTo(true),
      confirm: jasmine.createSpy('confirm').and.resolveTo({
        pricesRecorded: 1,
        pantryMoved: 2,
        pantryMerged: 3,
        store: 'Tienda inicial'
      })
    };
  }

  const i18nKey = (key: string) => key;

  beforeEach(async () => {
    service = createReceiptsService(makeReceipt());
    categories = signal([
      { key: 'dairy', name: 'Lácteos', color: '#aabbcc' },
      { key: 'other', name: 'Otros', color: '#ddeeff' }
    ]);
    pantry = { categories, loadCategories: jasmine.createSpy('loadCategories') };
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['info', 'success']);
    confirm = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirm.confirm.and.resolveTo(true);
    clipboard = jasmine.createSpyObj<ClipboardService>('ClipboardService', ['copy']);
    clipboard.copy.and.resolveTo();
    i18n = { changeTick: signal(0), t: jasmine.createSpy('t').and.callFake(i18nKey) };

    await TestBed.configureTestingModule({
      imports: [ReceiptDetailComponent],
      providers: [
        { provide: ReceiptsService, useValue: service },
        { provide: PantryService, useValue: pantry },
        { provide: ToastService, useValue: toast },
        { provide: ConfirmService, useValue: confirm },
        { provide: ClipboardService, useValue: clipboard },
        { provide: I18nService, useValue: i18n },
        provideRouter([
          { path: 'receipts', children: [] },
          { path: 'pantry', children: [] }
        ]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: { get: (key: string) => (key === 'id' ? RECEIPT_ID : null) } }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ReceiptDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    router = TestBed.inject(Router);
  });

  afterEach(() => fixture?.destroy());

  it('loads the route receipt and categories, and initializes editable metadata from its signal', () => {
    expect(service.watch).toHaveBeenCalled();
    expect(service.loadReceipt).toHaveBeenCalledOnceWith(RECEIPT_ID);
    expect(pantry.loadCategories).toHaveBeenCalledOnceWith();
    expect(component.tiendaDraft()).toBe('Tienda inicial');
    expect(component.fechaCompraDraft()).toBe('2026-08-21');
    expect(component.metadatosCambiados()).toBeFalse();
    expect(fixture.nativeElement.querySelector('#ticket-tienda')).not.toBeNull();
  });

  it('initializes null metadata as empty drafts and updates drafts only for a new receipt id', () => {
    fixture.destroy();
    service.receipt.set(null);
    fixture = TestBed.createComponent(ReceiptDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    service.receipt.set(makeReceipt({ store: null, purchaseDate: null }));
    fixture.detectChanges();
    expect(component.tiendaDraft()).toBe('');
    expect(component.fechaCompraDraft()).toBe('');

    component.cambiarTienda('unsaved draft');
    service.receipt.set(makeReceipt({ id: 'another-receipt', store: 'Otra tienda' }));
    fixture.detectChanges();
    expect(component.tiendaDraft()).toBe('unsaved draft');
  });

  it('keeps store and purchase date editable in active and terminal receipt states', () => {
    for (const status of [
      'queued',
      'analyzing',
      'review',
      'confirmed',
      'failed',
      'stopped'
    ] as const) {
      expect(component.metadatosEditables(status)).toBeTrue();
    }

    service.receipt.set(makeReceipt({ status: 'queued', store: null, purchaseDate: null }));
    fixture.detectChanges();
    const storeField = fixture.nativeElement.querySelector('#ticket-tienda') as HTMLInputElement;
    const dateField = fixture.nativeElement.querySelector(
      '#ticket-fecha-compra'
    ) as HTMLInputElement;
    expect(storeField).not.toBeNull();
    expect(dateField).not.toBeNull();
    expect(storeField.disabled).toBeFalse();
    expect(dateField.disabled).toBeFalse();

    component.cambiarTienda('Tienda manual en cola');
    component.cambiarFechaCompra('2024-02-29');
    service.receipt.set(makeReceipt({ status: 'analyzing', store: null, purchaseDate: null }));
    fixture.detectChanges();
    expect(component.tiendaDraft()).toBe('Tienda manual en cola');
    expect(component.fechaCompraDraft()).toBe('2024-02-29');

    service.receipt.set(makeReceipt({ status: 'confirmed' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#ticket-tienda')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#ticket-notas')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="ticket-confirmed"]')).not.toBeNull();
  });

  it('submits only changed metadata, trims store, and represents cleared values as null', async () => {
    component.cambiarTienda('  Supermercado  ');
    component.cambiarFechaCompra('');
    await component.guardarMetadatos();

    expect(service.updateReceipt).toHaveBeenCalledOnceWith(RECEIPT_ID, {
      store: 'Supermercado',
      purchaseDate: null
    });
    expect(component.metadatosGuardados()).toBeTrue();
    expect(component.errorMetadatos()).toBeFalse();
    expect(component.metadatosGuardando()).toBeFalse();
  });

  it('omits unchanged fields from the metadata patch and does nothing for unchanged values', async () => {
    component.cambiarFechaCompra('2026-08-22');
    await component.guardarMetadatos();
    expect(service.updateReceipt).toHaveBeenCalledOnceWith(RECEIPT_ID, {
      purchaseDate: '2026-08-22'
    });

    service.updateReceipt.calls.reset();
    component.cambiarTienda('Tienda inicial');
    component.cambiarFechaCompra('2026-08-21');
    await component.guardarMetadatos();
    expect(service.updateReceipt).not.toHaveBeenCalled();
  });

  it('clears saved and error feedback when metadata changes, then supports a retry after failure', async () => {
    component.cambiarTienda('Tienda editada');
    service.updateReceipt.and.resolveTo(null);
    await component.guardarMetadatos();
    expect(component.errorMetadatos()).toBeTrue();
    expect(component.metadatosGuardados()).toBeFalse();

    component.cambiarFechaCompra('2026-09-01');
    expect(component.errorMetadatos()).toBeFalse();
    expect(component.metadatosGuardados()).toBeFalse();
    service.updateReceipt.and.resolveTo(makeReceipt());
    await component.guardarMetadatos();
    expect(component.errorMetadatos()).toBeFalse();
    expect(component.metadatosGuardados()).toBeTrue();
  });

  it('guards metadata save when no receipt exists or a save is already running', async () => {
    service.receipt.set(null);
    component.cambiarTienda('Nueva tienda');
    await component.guardarMetadatos();
    expect(service.updateReceipt).not.toHaveBeenCalled();

    service.receipt.set(makeReceipt());
    fixture.detectChanges();
    component.cambiarTienda('Tienda nueva');
    component.metadatosGuardando.set(true);
    await component.guardarMetadatos();
    expect(service.updateReceipt).not.toHaveBeenCalled();
  });

  it('saves trimmed notes or null when notes are cleared', async () => {
    await component.guardarNotas('  nota importante  ');
    await component.guardarNotas('   ');
    expect(service.updateReceipt.calls.argsFor(0)).toEqual([
      RECEIPT_ID,
      { notes: 'nota importante' }
    ]);
    expect(service.updateReceipt.calls.argsFor(1)).toEqual([RECEIPT_ID, { notes: null }]);
  });

  it('maps statuses and error codes, including unknown error codes', () => {
    expect(component.variante('queued')).toBe('primary');
    expect(component.variante('analyzing')).toBe('primary');
    expect(component.variante('review')).toBe('warning');
    expect(component.variante('confirmed')).toBe('success');
    expect(component.variante('failed')).toBe('error');
    expect(component.variante('stopped')).toBe('neutral');
    expect(component.estado('queued')).toBe('receipts.estado.queued');
    expect(component.estado('stopped')).toBe('receipts.estado.stopped');
    expect(component.textoDeError('NO_CONFIG')).toBe('receipts.error.NO_CONFIG');
    expect(component.textoDeError('BAD_JSON')).toBe('receipts.error.BAD_JSON');
    expect(component.textoDeError('TIMEOUT')).toBe('receipts.error.TIMEOUT');
    expect(component.textoDeError('PROVIDER')).toBe('receipts.error.PROVIDER');
    expect(component.textoDeError('UNRECOGNIZED')).toBe('receipts.error.PROVIDER');
  });

  it('explains a missing ticket file and provider HTTP authentication, quota and server errors', () => {
    expect(component.textoDeError('FILE_MISSING')).toBe('receipts.error.FILE_MISSING');
    expect(component.textoDeError('TIMEOUT')).toBe('receipts.error.TIMEOUT');

    const textoDeError = component.textoDeError.bind(component) as (
      codigo: string,
      job?: ReceiptJob | null
    ) => string;
    const diagnostics = (providerHttpStatus: number) =>
      ({ provider_http_status: providerHttpStatus }) as unknown as ReceiptJob;
    expect(textoDeError('PROVIDER', diagnostics(401))).toBe('receipts.error.PROVIDER_AUTH');
    expect(textoDeError('PROVIDER', diagnostics(403))).toBe('receipts.error.PROVIDER_AUTH');
    expect(textoDeError('PROVIDER', diagnostics(429))).toBe('receipts.error.PROVIDER_RATE_LIMIT');
    expect(textoDeError('PROVIDER', diagnostics(503))).toBe('receipts.error.PROVIDER_SERVER');
  });

  it('shows a per-ticket diagnostic copy action only for a failed ticket with a job', () => {
    service.receipt.set(makeReceipt({ status: 'failed', error: 'PROVIDER', job: makeJob() }));
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector(
      '[data-test="receipt-copy-diagnostic"]'
    ) as HTMLElement | null;
    const button = action?.matches('button')
      ? (action as HTMLButtonElement)
      : (action?.querySelector('button') as HTMLButtonElement | null);
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('receipts.copy_diagnostic');

    service.receipt.set(makeReceipt({ status: 'failed', error: 'PROVIDER', job: null }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="receipt-copy-diagnostic"]')).toBeNull();
  });

  it('copies only the allowlisted diagnostic for this ticket and announces success accessibly', async () => {
    const job = {
      ...makeJob(),
      provider_response_id: 'resp_synthetic123',
      provider_transport: 'responses_background',
      provider_http_status: 401,
      elapsed_ms: 451,
      diagnostic_stage: 'failed',
      error_detail: 'raw provider body and synthetic-secret-sentinel',
      provider_url: 'https://private.invalid/v1',
      api_key: 'synthetic-secret-sentinel',
      prompt: 'private prompt sentinel',
      output: 'private output sentinel'
    } as unknown as ReceiptJob;
    service.receipt.set(makeReceipt({ status: 'failed', error: 'PROVIDER', job }));
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector(
      '[data-test="receipt-copy-diagnostic"]'
    ) as HTMLElement | null;
    const button = action?.matches('button')
      ? (action as HTMLButtonElement)
      : (action?.querySelector('button') as HTMLButtonElement | null);
    const feedback = fixture.nativeElement.querySelector(
      '[role="status"][aria-live="polite"]'
    ) as HTMLElement | null;
    expect(feedback).not.toBeNull();
    expect(feedback?.textContent?.trim()).toBe('');
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(clipboard.copy).toHaveBeenCalledOnceWith(jasmine.any(String));
    const copied = clipboard.copy.calls.argsFor(0)[0] as string;
    expect(JSON.parse(copied)).toEqual({
      jobId: 'job-receipt-17',
      kind: 'receipt',
      status: 'failed',
      attempts: 4,
      maxAttempts: 4,
      createdAt: '2026-11-01T17:34:59.000Z',
      error: 'PROVIDER',
      diagnosticStage: 'failed',
      providerResponseId: 'resp_synthetic123',
      providerTransport: 'responses_background',
      providerHttpStatus: 401,
      elapsedMs: 451
    });
    expect(copied).not.toContain(RECEIPT_ID);
    expect(copied).not.toContain('synthetic-secret-sentinel');
    expect(copied).not.toContain('private.invalid');
    expect(copied).not.toContain('private prompt sentinel');
    expect(copied).not.toContain('private output sentinel');
    expect(feedback?.textContent).toContain('receipts.copy_diagnostic_success');
  });

  it('announces clipboard rejection without exposing the browser error', async () => {
    clipboard.copy.and.rejectWith(new Error('synthetic clipboard permission detail'));
    service.receipt.set(
      makeReceipt({
        status: 'failed',
        error: 'FILE_MISSING',
        job: makeJob({ error_code: 'FILE_MISSING' })
      })
    );
    fixture.detectChanges();

    const action = fixture.nativeElement.querySelector(
      '[data-test="receipt-copy-diagnostic"]'
    ) as HTMLElement | null;
    const button = action?.matches('button')
      ? (action as HTMLButtonElement)
      : (action?.querySelector('button') as HTMLButtonElement | null);
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const feedback = fixture.nativeElement.querySelector(
      '[role="status"][aria-live="polite"]'
    ) as HTMLElement | null;
    expect(feedback?.textContent).toContain('receipts.copy_diagnostic_failed');
    expect(fixture.nativeElement.textContent).not.toContain(
      'synthetic clipboard permission detail'
    );
  });

  it('resolves category names with a key fallback and exposes category picker options', () => {
    expect(component.nombreCategoria('dairy')).toBe('Lácteos');
    expect(component.nombreCategoria('unknown-category')).toBe('unknown-category');
    expect(component.opcionesCategoria()).toEqual([
      { value: 'dairy', label: 'Lácteos', color: '#aabbcc' },
      { value: 'other', label: 'Otros', color: '#ddeeff' }
    ]);
    expect(component.revisable('review')).toBeTrue();
    expect(component.revisable('confirmed')).toBeFalse();
  });

  it('shows the live reading state for queued and analyzing receipts, and turns it off for review', () => {
    service.receipt.set(makeReceipt({ status: 'queued' }));
    expect(component.enMarcha()).toBeTrue();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="ticket-reading"]')).not.toBeNull();

    service.receipt.set(makeReceipt({ status: 'analyzing' }));
    expect(component.enMarcha()).toBeTrue();
    service.receipt.set(makeReceipt({ status: 'review' }));
    expect(component.enMarcha()).toBeFalse();
  });

  it('calculates line totals, matching state, and handles missing receipts or totals', () => {
    expect(component.suma()).toBe(250);
    expect(component.cuadra()).toBeTrue();
    service.receipt.set(makeReceipt({ totalMinor: 300 }));
    expect(component.cuadra()).toBeFalse();
    service.receipt.set(makeReceipt({ totalMinor: null }));
    expect(component.cuadra()).toBeTrue();
    service.receipt.set(null);
    expect(component.suma()).toBe(0);
    expect(component.cuadra()).toBeTrue();
  });

  it('converts price and quantity text safely, including commas and invalid input', () => {
    expect(component.centimosDe('')).toBeNull();
    expect(component.centimosDe('  ')).toBeNull();
    expect(component.centimosDe('1,239')).toBe(124);
    expect(component.centimosDe('not a price')).toBeNull();
    expect(component.numeroDe('3,5')).toBe(3.5);
    expect(component.numeroDe('0')).toBe(1);
    expect(component.numeroDe('-2')).toBe(1);
    expect(component.numeroDe('invalid')).toBe(1);
  });

  it('updates a line then refreshes; parses valid offers and clears malformed offers', async () => {
    const line = component.lineas()[0];
    await component.editarLinea(line, { name: 'Leche entera' });
    expect(service.updateLine).toHaveBeenCalledOnceWith(RECEIPT_ID, 'line-1', {
      name: 'Leche entera'
    });
    expect(service.loadReceipt).toHaveBeenCalledWith(RECEIPT_ID);

    await component.editarOferta(line, ' 3 X 2 ');
    expect(service.updateLine.calls.mostRecent().args[2]).toEqual({ offer: { buy: 3, take: 2 } });
    await component.editarOferta(line, 'oferta inválida');
    expect(service.updateLine.calls.mostRecent().args[2]).toEqual({ offer: null });
    expect(component.ofertaTexto(makeLine({ offer: { buy: 2, take: 1 } }))).toBe('2x1');
    expect(component.ofertaTexto(makeLine({ offer: null }))).toBe('');
  });

  it('does not refresh a line after a failed update so its draft is retained', async () => {
    service.updateLine.and.resolveTo(null);
    service.loadReceipt.calls.reset();

    await component.editarLinea(component.lineas()[0], { note: 'Borrador sin guardar' });

    expect(service.updateLine).toHaveBeenCalledOnceWith(RECEIPT_ID, 'line-1', {
      note: 'Borrador sin guardar'
    });
    expect(service.loadReceipt).not.toHaveBeenCalled();
  });

  it('adds a line, stores the new id for highlighting, and handles a failed creation', async () => {
    await component.anadirLinea();
    expect(service.addLine).toHaveBeenCalledOnceWith(RECEIPT_ID, {
      name: 'receipts.nombre',
      quantity: 1,
      category: 'other'
    });
    expect(service.loadReceipt).toHaveBeenCalledWith(RECEIPT_ID);
    expect(component.ultimaNueva()).toBe('line-new');

    service.addLine.and.resolveTo(null);
    await component.anadirLinea();
    expect(component.ultimaNueva()).toBe('line-new');
  });

  it('deletes a line only after confirmation', async () => {
    const line = component.lineas()[0];
    confirm.confirm.and.resolveTo(false);
    await component.quitarLinea(line);
    expect(confirm.confirm).toHaveBeenCalledWith(
      jasmine.objectContaining({ message: 'Leche', variant: 'danger' })
    );
    expect(service.deleteLine).not.toHaveBeenCalled();

    confirm.confirm.and.resolveTo(true);
    await component.quitarLinea(line);
    expect(service.deleteLine).toHaveBeenCalledOnceWith(RECEIPT_ID, 'line-1');
    expect(service.loadReceipt).toHaveBeenCalledWith(RECEIPT_ID);
  });

  it('stops a job and retries failed work with a receipt refresh', async () => {
    service.loadReceipt.calls.reset();
    await component.parar();
    expect(service.stopJob).toHaveBeenCalledOnceWith(RECEIPT_ID);
    expect(service.loadReceipt).toHaveBeenCalledWith(RECEIPT_ID);

    await component.reintentar();
    expect(service.retryJob).toHaveBeenCalledOnceWith(RECEIPT_ID);
    expect(service.loadReceipt).toHaveBeenCalledTimes(2);
  });

  it('does not delete until confirmed, then deletes, toasts, and navigates away', async () => {
    confirm.confirm.and.resolveTo(false);
    await component.borrar();
    expect(service.deleteReceipt).not.toHaveBeenCalled();

    confirm.confirm.and.resolveTo(true);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    await component.borrar();
    expect(confirm.confirm.calls.mostRecent().args[0].message).toBe('Tienda inicial');
    expect(service.deleteReceipt).toHaveBeenCalledOnceWith(RECEIPT_ID);
    expect(toast.info).toHaveBeenCalledWith('receipts.ticket_borrado');
    expect(navigate).toHaveBeenCalledOnceWith(['/receipts']);
  });

  it('uses the file name or an empty string when confirming receipt deletion without a store', async () => {
    service.receipt.set(makeReceipt({ store: null, fileName: 'receipt.pdf' }));
    await component.borrar();
    expect(confirm.confirm.calls.mostRecent().args[0].message).toBe('receipt.pdf');
    service.receipt.set(makeReceipt({ store: null, fileName: null }));
    await component.borrar();
    expect(confirm.confirm.calls.mostRecent().args[0].message).toBe('');
  });

  it('confirms once, refreshes and toasts on success, and resets its busy state on no result', async () => {
    await component.confirmar();
    expect(service.confirm).toHaveBeenCalledOnceWith(RECEIPT_ID);
    expect(component.confirmando()).toBeFalse();
    expect(component.resultado()).toEqual(
      jasmine.objectContaining({
        pricesRecorded: 1,
        pantryMoved: 2,
        pantryMerged: 3
      })
    );
    expect(service.loadReceipt).toHaveBeenCalledWith(RECEIPT_ID);
    expect(toast.success).toHaveBeenCalledWith('receipts.confirmado', 'receipts.ver_inventario');

    service.confirm.and.resolveTo(null);
    service.loadReceipt.calls.reset();
    await component.confirmar();
    expect(component.confirmando()).toBeFalse();
    expect(service.loadReceipt).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('guards a duplicate confirmation while a confirmation request is already active', async () => {
    component.confirmando.set(true);
    await component.confirmar();
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('renders terminal receipt lines read-only and hides deletion for confirmed receipts', () => {
    service.receipt.set(makeReceipt({ status: 'confirmed' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#line-line-1-nombre')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="confirmar-ticket"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="ticket-confirmed"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#ticket-notas')).toBeNull();
  });

  it('shows error and warnings, keeps review fields editable, and disables confirmation for no lines', () => {
    service.receipt.set(
      makeReceipt({
        error: 'BAD_JSON',
        warnings: ['Línea dudosa'],
        lines: [],
        items: 0,
        totalMinor: null
      })
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-test="ticket-error"]')?.textContent
    ).toContain('receipts.error.BAD_JSON');
    expect(fixture.nativeElement.querySelector('.ficha__avisos')?.textContent).toContain(
      'Línea dudosa'
    );
    const confirmButton = fixture.nativeElement.querySelector(
      '[data-test="confirmar-ticket"] button'
    ) as HTMLButtonElement | null;
    expect(confirmButton?.disabled).toBeTrue();
  });

  it('unwatches the service when the component is destroyed', () => {
    fixture.destroy();
    expect(service.unwatch).toHaveBeenCalledOnceWith();
  });

  it('stops the live poll when the receipt changes to a terminal state', fakeAsync(() => {
    fixture.destroy();
    service.receipt.set(makeReceipt({ status: 'analyzing' }));
    fixture = TestBed.createComponent(ReceiptDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    tick(1000);
    expect(service.refreshReceipt).toHaveBeenCalledWith(RECEIPT_ID);
    service.receipt.set(makeReceipt({ status: 'review' }));
    tick(2000);
    const callsAtStop = service.refreshReceipt.calls.count();
    tick(2000);
    expect(service.refreshReceipt.calls.count()).toBe(callsAtStop);
  }));
});
