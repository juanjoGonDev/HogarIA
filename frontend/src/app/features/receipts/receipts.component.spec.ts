import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { ReceiptsService } from '../../core/services/receipts.service';
import type {
  Receipt,
  ReceiptQueueSnapshot,
  ReceiptStatus
} from '../../shared/models/receipt.model';
import { ReceiptsComponent } from './receipts.component';

function queueSnapshot(jobs: ReceiptQueueSnapshot['jobs'] = []): ReceiptQueueSnapshot {
  return {
    jobs,
    counts: { queued: 0, running: 0, failed: 0 }
  };
}

function ticket(id: string, status: ReceiptStatus = 'review'): Receipt {
  return {
    id,
    status,
    store: 'Mercado local',
    purchaseDate: '2026-10-01',
    currency: 'EUR',
    totalMinor: 1234,
    notes: null,
    fileUrl: `/api/receipts/${id}/file`,
    fileKind: 'png',
    fileName: `${id}.png`,
    error: null,
    warnings: [],
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    confirmedAt: null,
    items: 1
  };
}

describe('ReceiptsComponent', () => {
  let fixture: ComponentFixture<ReceiptsComponent>;
  let component: ReceiptsComponent;
  let service: jasmine.SpyObj<ReceiptsService>;
  let receipts: ReturnType<typeof signal<Receipt[]>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let history: ReturnType<typeof signal<Receipt[]>>;
  let historyLoading: ReturnType<typeof signal<boolean>>;
  let historyHasMore: ReturnType<typeof signal<boolean>>;
  let historyError: ReturnType<typeof signal<boolean>>;
  let queue: ReturnType<typeof signal<ReceiptQueueSnapshot>>;

  beforeEach(async () => {
    receipts = signal<Receipt[]>([]);
    loading = signal(false);
    history = signal<Receipt[]>([]);
    historyLoading = signal(false);
    historyHasMore = signal(false);
    historyError = signal(false);
    queue = signal(queueSnapshot());

    service = jasmine.createSpyObj<ReceiptsService>(
      'ReceiptsService',
      [
        'watch',
        'unwatch',
        'loadReceipts',
        'loadHistory',
        'loadMoreHistory',
        'retryHistory',
        'upload',
        'refreshQueue'
      ],
      {
        receipts,
        loading,
        history,
        historyLoading,
        historyHasMore,
        historyError,
        queue
      }
    );
    service.upload.and.resolveTo(null);
    service.refreshQueue.and.returnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [ReceiptsComponent],
      providers: [
        { provide: ReceiptsService, useValue: service },
        {
          provide: I18nService,
          useValue: {
            changeTick: signal(0),
            t: (key: string) => key
          }
        },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ReceiptsComponent);
    component = fixture.componentInstance;
  });

  it('starts queue watching and loads both sections once, then unwatches on destroy', () => {
    fixture.detectChanges();

    expect(service.watch).toHaveBeenCalledTimes(1);
    expect(service.loadReceipts).toHaveBeenCalledTimes(1);
    expect(service.loadHistory).toHaveBeenCalledTimes(1);

    fixture.destroy();

    expect(service.unwatch).toHaveBeenCalledTimes(1);
  });

  it('refreshes active tickets and history when a watched queue job changes state', async () => {
    const queuedJob = {
      id: 'job-1',
      status: 'queued' as const,
      attempts: 0,
      max_attempts: 3,
      error_code: null,
      created_at: '2026-10-01T12:00:00.000Z',
      receipt_id: 'receipt-1',
      store: null,
      file_name: 'receipt.png',
      receipt_status: 'queued' as const,
      items: 0
    };
    // The first server snapshot is the baseline; mounting already loaded both sections.
    queue.set(queueSnapshot([queuedJob]));
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.flushEffects();

    expect(service.loadReceipts).toHaveBeenCalledTimes(1);
    expect(service.loadHistory).toHaveBeenCalledTimes(1);

    // Counts and other snapshot details are deliberately not part of the queue signature.
    queue.set({
      ...queueSnapshot([{ ...queuedJob, attempts: 1 }]),
      counts: { queued: 1, running: 0, failed: 0 }
    });
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.flushEffects();
    expect(service.loadReceipts).toHaveBeenCalledTimes(1);
    expect(service.loadHistory).toHaveBeenCalledTimes(1);

    queue.set(queueSnapshot([{ ...queuedJob, status: 'failed', receipt_status: 'failed' }]));
    fixture.detectChanges();
    await fixture.whenStable();
    TestBed.flushEffects();
    expect(service.loadReceipts).toHaveBeenCalledTimes(2);
    expect(service.loadHistory).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state only after active and history loading finish', () => {
    loading.set(true);
    historyLoading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tickets__vacio')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tickets__history-empty')).toBeNull();

    loading.set(false);
    historyLoading.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tickets__vacio')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tickets__history-empty')).not.toBeNull();
  });

  it('renders history errors without a false empty state and invokes retry/load-more', () => {
    historyError.set(true);
    historyHasMore.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tickets__history-empty')).toBeNull();
    const buttons = fixture.nativeElement.querySelectorAll('app-button button');
    expect(buttons.length).toBe(2);

    buttons[0].click();
    buttons[1].click();

    expect(service.retryHistory).toHaveBeenCalledTimes(1);
    expect(service.loadMoreHistory).toHaveBeenCalledTimes(1);
  });

  it('renders active and historical receipt rows with their status labels', () => {
    receipts.set([ticket('active', 'analyzing')]);
    history.set([ticket('past', 'confirmed')]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="ticket-analyzing"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="ticket-history-item"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Mercado local');
    expect(fixture.nativeElement.textContent).toContain('receipts.fecha_compra');
    expect(fixture.nativeElement.textContent).toContain('receipts.estado.analyzing');
    expect(fixture.nativeElement.textContent).toContain('receipts.estado.confirmed');
  });

  it('maps every receipt status to its visual variant and translation key', () => {
    const statuses: ReceiptStatus[] = [
      'queued',
      'analyzing',
      'review',
      'confirmed',
      'failed',
      'stopped'
    ];
    const variants = ['primary', 'primary', 'warning', 'success', 'error', 'neutral'];

    statuses.forEach((status, index) => {
      expect(component.variante(status)).toBe(variants[index]);
      expect(component.estado(status)).toBe(`receipts.estado.${status}`);
    });
  });

  it('prevents unsupported and oversized uploads without calling the service', () => {
    const unsupported = new File(['not a receipt'], 'notes.txt', { type: 'text/plain' });
    component.elegir({
      target: { files: [unsupported], value: 'C:\\fakepath\\notes.txt' }
    } as unknown as Event);
    expect(component.errorSubida()).toBe('receipts.eso_no_es_un_ticket');

    const oversized = new File(['small fixture'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });
    component.elegir({
      target: { files: [oversized], value: 'C:\\fakepath\\large.png' }
    } as unknown as Event);

    expect(component.errorSubida()).toBe('receipts.pesa_demasiado');
    expect(service.upload).not.toHaveBeenCalled();
    expect(component.subiendo()).toBeFalse();
  });

  it('clears the file input and shows an upload error when the service rejects the file', async () => {
    fixture.detectChanges();
    const file = new File(['receipt'], 'receipt.webp', { type: 'image/webp' });
    const input = { files: [file], value: 'C:\\fakepath\\receipt.webp' };
    service.upload.and.resolveTo(null);

    component.elegir({ target: input } as unknown as Event);
    expect(input.value).toBe('');
    expect(component.subiendo()).toBeTrue();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.upload).toHaveBeenCalledOnceWith(file);
    expect(component.subiendo()).toBeFalse();
    expect(component.errorSubida()).toBe('receipts.no_se_ha_podido');
    expect(fixture.nativeElement.querySelector('[data-test="ticket-upload-error"]')).not.toBeNull();
    expect(service.loadReceipts).toHaveBeenCalledTimes(1);
  });

  it('refreshes active, historical, and queue data after a successful drop upload', async () => {
    fixture.detectChanges();
    const file = new File(['receipt PDF fixture'], 'receipt.pdf', { type: 'application/pdf' });
    service.upload.and.resolveTo(ticket('new-receipt', 'queued'));
    const preventDefault = jasmine.createSpy('preventDefault');
    const event = {
      preventDefault,
      dataTransfer: { files: [file] }
    } as unknown as DragEvent;

    component.alArrastrar(event, true);
    expect(component.arrastrando()).toBeTrue();
    component.alSoltar(event);
    expect(component.arrastrando()).toBeFalse();
    expect(preventDefault).toHaveBeenCalledTimes(2);
    await fixture.whenStable();

    expect(service.upload).toHaveBeenCalledOnceWith(file);
    expect(service.loadReceipts).toHaveBeenCalledTimes(2);
    expect(service.loadHistory).toHaveBeenCalledTimes(2);
    expect(service.refreshQueue).toHaveBeenCalledTimes(1);
    expect(component.errorSubida()).toBeNull();
    expect(component.subiendo()).toBeFalse();
  });

  it('clears drag state on drag leave and ignores a drop without files', () => {
    const preventDefault = jasmine.createSpy('preventDefault');
    const event = { preventDefault, dataTransfer: { files: [] } } as unknown as DragEvent;

    component.alArrastrar(event, true);
    component.alArrastrar(event, false);
    component.alSoltar(event);

    expect(preventDefault).toHaveBeenCalledTimes(3);
    expect(component.arrastrando()).toBeFalse();
    expect(service.upload).not.toHaveBeenCalled();
  });
});
