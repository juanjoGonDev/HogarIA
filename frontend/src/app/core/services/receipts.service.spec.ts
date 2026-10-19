import { fakeAsync, TestBed, tick, discardPeriodicTasks } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { I18nService } from './i18n.service';
import { ReceiptsService } from './receipts.service';
import { ToastService } from './toast.service';
import type {
  Receipt,
  ReceiptConfirmResult,
  ReceiptDetail,
  ReceiptItem,
  ReceiptQueueSnapshot
} from '../../shared/models/receipt.model';

const API = '/api/receipts';

const RECEIPT: Receipt = {
  id: 'receipt-1',
  status: 'queued',
  store: 'Tienda de prueba',
  purchaseDate: null,
  currency: 'EUR',
  totalMinor: 725,
  notes: null,
  fileUrl: '/uploads/receipt-1.pdf',
  fileKind: 'pdf',
  fileName: 'ticket.pdf',
  error: null,
  warnings: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  confirmedAt: null,
  items: 1
};

const LINE: ReceiptItem = {
  id: 'line-1',
  name: 'Tomates de prueba',
  quantity: 2,
  unit: 'ud',
  category: 'vegetables',
  priceMinor: 725,
  offer: null,
  note: null,
  confidence: 0.98
};

const DETAIL: ReceiptDetail = {
  ...RECEIPT,
  lines: [LINE],
  job: null
};

const QUEUE: ReceiptQueueSnapshot = {
  jobs: [],
  counts: { queued: 0, running: 0, failed: 0 }
};

const CONFIRM_RESULT: ReceiptConfirmResult = {
  pricesRecorded: 1,
  pantryMoved: 1,
  pantryMerged: 0,
  store: 'Tienda de prueba'
};

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  let translate: jasmine.Spy;

  const configureService = () => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ReceiptsService,
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: { t: translate } }
      ]
    });

    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ReceiptsService);
  };

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error']);
    translate = jasmine.createSpy('t').and.callFake((key: string) => key);
    configureService();
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  it('starts with empty signals and updates list/detail loading signals on success', () => {
    expect(service.receipts()).toEqual([]);
    expect(service.loading()).toBeFalse();
    expect(service.receipt()).toBeNull();
    expect(service.loadingReceipt()).toBeFalse();
    expect(service.queue()).toEqual(QUEUE);
    expect(service.queueBusy()).toBeFalse();

    service.loadReceipts();
    expect(service.loading()).toBeTrue();
    const list = http.expectOne(`${API}?scope=active&limit=100`);
    expect(list.request.method).toBe('GET');
    list.flush({ success: true, data: [RECEIPT] });
    expect(service.receipts()).toEqual([RECEIPT]);
    expect(service.loading()).toBeFalse();

    service.loadReceipt(RECEIPT.id);
    expect(service.loadingReceipt()).toBeTrue();
    const detail = http.expectOne(`${API}/${RECEIPT.id}`);
    expect(detail.request.method).toBe('GET');
    detail.flush({ success: true, data: DETAIL });
    expect(service.receipt()).toEqual(DETAIL);
    expect(service.loadingReceipt()).toBeFalse();
  });

  it('clears loading on list/detail errors without discarding the last good data', () => {
    service.receipts.set([RECEIPT]);
    service.loadReceipts();
    expect(service.loading()).toBeTrue();
    http
      .expectOne(`${API}?scope=active&limit=100`)
      .flush({ error: 'temporary' }, { status: 503, statusText: 'Service Unavailable' });
    expect(service.loading()).toBeFalse();
    expect(service.receipts()).toEqual([RECEIPT]);

    service.receipt.set(DETAIL);
    service.loadReceipt(RECEIPT.id);
    expect(service.loadingReceipt()).toBeTrue();
    http
      .expectOne(`${API}/${RECEIPT.id}`)
      .flush({ error: 'temporary' }, { status: 503, statusText: 'Service Unavailable' });
    expect(service.loadingReceipt()).toBeFalse();
    expect(service.receipt()).toEqual(DETAIL);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('loads history in pages, appends older receipts and preserves its cursor after errors', () => {
    const pageOf = (start: number) =>
      Array.from({ length: 50 }, (_, index) => ({
        ...RECEIPT,
        id: `receipt-${start + index}`,
        status: 'confirmed' as const
      }));
    service.loadHistory();
    expect(service.historyLoading()).toBeTrue();
    const first = http.expectOne(`${API}?scope=history&limit=50&offset=0`);
    expect(first.request.method).toBe('GET');
    first.flush({
      success: true,
      data: pageOf(0),
      pagination: { offset: 0, limit: 50, hasMore: true }
    });
    expect(service.history().length).toBe(50);
    expect(service.historyHasMore()).toBeTrue();
    expect(service.historyLoading()).toBeFalse();

    service.loadMoreHistory();
    const second = http.expectOne(`${API}?scope=history&limit=50&offset=50`);
    second.flush({
      success: true,
      data: pageOf(50),
      pagination: { offset: 50, limit: 50, hasMore: true }
    });
    expect(service.history().length).toBe(100);
    expect(service.historyHasMore()).toBeTrue();
    expect(service.historyLoading()).toBeFalse();

    service.loadMoreHistory();
    http
      .expectOne(`${API}?scope=history&limit=50&offset=100`)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(service.history().length).toBe(100);
    expect(service.historyHasMore()).toBeTrue();
    expect(service.historyError()).toBeTrue();
    expect(service.historyLoading()).toBeFalse();

    service.retryHistory();
    http.expectOne(`${API}?scope=history&limit=50&offset=100`).flush({
      success: true,
      data: [{ ...RECEIPT, id: 'receipt-oldest', status: 'failed' }],
      pagination: { offset: 100, limit: 50, hasMore: false }
    });
    expect(service.history().length).toBe(101);
    expect(service.historyHasMore()).toBeFalse();
    expect(service.historyError()).toBeFalse();
  });

  it('retries a failed history refresh from the first page without dropping loaded history', () => {
    service.history.set([RECEIPT]);
    service.loadHistory();
    http
      .expectOne(`${API}?scope=history&limit=50&offset=0`)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(service.history()).toEqual([RECEIPT]);
    expect(service.historyError()).toBeTrue();

    service.retryHistory();
    http.expectOne(`${API}?scope=history&limit=50&offset=0`).flush({
      success: true,
      data: [RECEIPT],
      pagination: { offset: 0, limit: 50, hasMore: false }
    });
    expect(service.history()).toEqual([RECEIPT]);
    expect(service.historyError()).toBeFalse();
  });

  it('uploads a synthetic File as multipart and unwraps the receipt response', async () => {
    const file = new File(['%PDF-1.4 synthetic test receipt'], 'ticket.pdf', {
      type: 'application/pdf'
    });
    const pending = service.upload(file);
    const request = http.expectOne(API);
    expect(request.request.method).toBe('POST');
    expect(request.request.body instanceof FormData).toBeTrue();
    const uploaded = (request.request.body as FormData).get('file');
    expect(uploaded instanceof File).toBeTrue();
    expect((uploaded as File).name).toBe('ticket.pdf');
    expect((uploaded as File).type).toBe('application/pdf');

    request.flush({ success: true, data: RECEIPT });
    expect(await pending).toEqual(RECEIPT);
  });

  it('unwraps queue/detail refreshes and turns poll errors into null without a toast', () => {
    let queueValue: null | undefined;
    service.refreshQueue().subscribe((value) => (queueValue = value));
    http.expectOne(`${API}/queue`).flush({ success: true, data: QUEUE });
    expect(queueValue).toBeNull();
    expect(service.queue()).toEqual(QUEUE);

    let detailValue: null | undefined;
    service.refreshReceipt(RECEIPT.id).subscribe((value) => (detailValue = value));
    http.expectOne(`${API}/${RECEIPT.id}`).flush({ success: true, data: DETAIL });
    expect(detailValue).toBeNull();
    expect(service.receipt()).toEqual(DETAIL);

    const previousQueue: ReceiptQueueSnapshot = {
      jobs: [],
      counts: { queued: 2, running: 1, failed: 0 }
    };
    service.queue.set(previousQueue);
    let failedQueueValue: null | undefined;
    service.refreshQueue().subscribe((value) => (failedQueueValue = value));
    http.expectOne(`${API}/queue`).flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(failedQueueValue).toBeNull();
    expect(service.queue()).toEqual(previousQueue);

    let failedDetailValue: null | undefined;
    service.refreshReceipt(RECEIPT.id).subscribe((value) => (failedDetailValue = value));
    http
      .expectOne(`${API}/${RECEIPT.id}`)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(failedDetailValue).toBeNull();
    expect(service.receipt()).toEqual(DETAIL);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('sends receipt and line CRUD plus confirm/stop/retry requests with their API contracts', async () => {
    service.receipt.set(DETAIL);
    service.receipts.set([RECEIPT]);
    service.history.set([RECEIPT]);
    const headerPatch = {
      store: 'Mercado de prueba',
      purchaseDate: '2026-10-01',
      notes: 'Compra semanal'
    };
    const updateReceipt = service.updateReceipt(RECEIPT.id, headerPatch);
    const headerRequest = http.expectOne(`${API}/${RECEIPT.id}`);
    expect(headerRequest.request.method).toBe('PATCH');
    expect(headerRequest.request.body).toEqual(headerPatch);
    const updatedReceipt = {
      ...RECEIPT,
      store: 'Mercado de prueba',
      purchaseDate: '2026-10-01',
      notes: 'Compra semanal'
    };
    headerRequest.flush({ success: true, data: updatedReceipt });
    expect(await updateReceipt).toEqual(updatedReceipt);
    expect(service.receipt()).toEqual(jasmine.objectContaining(updatedReceipt));
    expect(service.receipts()[0]).toEqual(jasmine.objectContaining(updatedReceipt));
    expect(service.history()[0]).toEqual(jasmine.objectContaining(updatedReceipt));

    const deleteReceipt = service.deleteReceipt(RECEIPT.id);
    const deleteReceiptRequest = http.expectOne(`${API}/${RECEIPT.id}`);
    expect(deleteReceiptRequest.request.method).toBe('DELETE');
    const deleted = { success: true, data: { ok: true } };
    deleteReceiptRequest.flush(deleted);
    expect(await deleteReceipt).toEqual(deleted);

    const newLine = { name: 'Pan de prueba', quantity: 1, category: 'other' };
    const addLine = service.addLine(RECEIPT.id, newLine);
    const addRequest = http.expectOne(`${API}/${RECEIPT.id}/items`);
    expect(addRequest.request.method).toBe('POST');
    expect(addRequest.request.body).toEqual(newLine);
    addRequest.flush({ success: true, data: { id: 'line-new' } });
    expect(await addLine).toEqual({ id: 'line-new' });

    const linePatch = { priceMinor: 825, offer: { buy: 3, take: 2 } };
    const updateLine = service.updateLine(RECEIPT.id, LINE.id, linePatch);
    const updateLineRequest = http.expectOne(`${API}/${RECEIPT.id}/items/${LINE.id}`);
    expect(updateLineRequest.request.method).toBe('PATCH');
    expect(updateLineRequest.request.body).toEqual(linePatch);
    updateLineRequest.flush({ success: true, data: { id: LINE.id } });
    expect(await updateLine).toEqual({ id: LINE.id });

    const deleteLine = service.deleteLine(RECEIPT.id, LINE.id);
    const deleteLineRequest = http.expectOne(`${API}/${RECEIPT.id}/items/${LINE.id}`);
    expect(deleteLineRequest.request.method).toBe('DELETE');
    deleteLineRequest.flush(deleted);
    expect(await deleteLine).toEqual(deleted);

    const confirm = service.confirm(RECEIPT.id);
    const confirmRequest = http.expectOne(`${API}/${RECEIPT.id}/confirm`);
    expect(confirmRequest.request.method).toBe('POST');
    expect(confirmRequest.request.body).toEqual({});
    confirmRequest.flush({ success: true, data: CONFIRM_RESULT });
    expect(await confirm).toEqual(CONFIRM_RESULT);

    const stop = service.stopJob(RECEIPT.id);
    const stopRequest = http.expectOne(`${API}/${RECEIPT.id}/stop`);
    expect(stopRequest.request.method).toBe('POST');
    expect(stopRequest.request.body).toEqual({});
    const stopped = { success: true, data: { stopped: 1 } };
    stopRequest.flush(stopped);
    expect(await stop).toEqual(stopped);

    const retry = service.retryJob(RECEIPT.id);
    const retryRequest = http.expectOne(`${API}/${RECEIPT.id}/retry`);
    expect(retryRequest.request.method).toBe('POST');
    expect(retryRequest.request.body).toEqual({});
    const retried = { success: true, data: { requeued: true } };
    retryRequest.flush(retried);
    expect(await retry).toEqual(retried);
  });

  it('returns null and shows the translated error toast when a mutation fails', async () => {
    const pending = service.updateReceipt(RECEIPT.id, { store: 'No guardada' });
    const request = http.expectOne(`${API}/${RECEIPT.id}`);
    expect(request.request.method).toBe('PATCH');
    request.flush({ error: 'temporary' }, { status: 500, statusText: 'Server Error' });

    expect(await pending).toBeNull();
    expect(translate).toHaveBeenCalledWith('ui.error');
    expect(translate).toHaveBeenCalledWith('receipts.error_operacion');
    expect(toast.error).toHaveBeenCalledOnceWith('ui.error', 'receipts.error_operacion');
  });

  it('keeps queueBusy through stop-all and clears it on both success and failure', async () => {
    const success = service.stopAll();
    expect(service.queueBusy()).toBeTrue();
    const successRequest = http.expectOne(`${API}/queue/stop`);
    expect(successRequest.request.method).toBe('POST');
    expect(successRequest.request.body).toEqual({});
    const stopped = { success: true, data: { stopped: 2 } };
    successRequest.flush(stopped);
    expect(await success).toEqual(stopped);
    expect(service.queueBusy()).toBeFalse();

    const failure = service.stopAll();
    expect(service.queueBusy()).toBeTrue();
    http
      .expectOne(`${API}/queue/stop`)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(await failure).toBeNull();
    expect(service.queueBusy()).toBeFalse();
    expect(toast.error).toHaveBeenCalledOnceWith('ui.error', 'receipts.error_operacion');
  });

  it('refreshes immediately for the first watcher, polls once per second while watched, and clamps at zero', fakeAsync(() => {
    try {
      TestBed.resetTestingModule();
      configureService();

      service.watch();
      const immediate = http.expectOne(`${API}/queue`);
      expect(immediate.request.method).toBe('GET');
      immediate.flush({ success: true, data: QUEUE });

      service.watch();
      http.expectNone(`${API}/queue`);
      tick(999);
      http.expectNone(`${API}/queue`);
      tick(1);
      http.expectOne(`${API}/queue`).flush({ success: true, data: QUEUE });

      service.unwatch();
      tick(1000);
      http.expectOne(`${API}/queue`).flush({ success: true, data: QUEUE });

      service.unwatch();
      tick(1000);
      http.expectNone(`${API}/queue`);
      service.unwatch();
      tick(1000);
      http.expectNone(`${API}/queue`);
    } finally {
      discardPeriodicTasks();
    }
  }));

  it('cancels in-flight loading and queue polling when the service injector is destroyed', fakeAsync(() => {
    try {
      TestBed.resetTestingModule();
      configureService();

      service.watch();
      const startupRequests = http.match(`${API}/queue`);
      expect(startupRequests.length).toBeLessThanOrEqual(1);
      startupRequests.forEach((request) => request.flush({ success: true, data: QUEUE }));

      service.loadReceipts();
      const listRequest = http.expectOne(`${API}?scope=active&limit=100`);
      tick(1000);
      const pollRequest = http.expectOne(`${API}/queue`);

      TestBed.resetTestingModule();
      expect(listRequest.cancelled).toBeTrue();
      expect(pollRequest.cancelled).toBeTrue();
    } finally {
      discardPeriodicTasks();
    }
  }));
});
