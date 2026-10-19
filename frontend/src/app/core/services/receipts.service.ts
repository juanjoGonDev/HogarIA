import { Injectable, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ToastService } from './toast.service';
import { I18nService } from './i18n.service';
import {
  Receipt,
  ReceiptConfirmResult,
  ReceiptDetail,
  ReceiptItem,
  ReceiptJob,
  ReceiptHistoryPage,
  ReceiptQueueSnapshot
} from '../../shared/models/receipt.model';

/**
 * El servicio de la lectura de tickets (HOGARIA-SPEC ## 12aj).
 *
 * Dos decisiones de pantalla, no de backend:
 *
 *  1. La cola se consulta por POLLING (`/queue` cada segundo mientras haya trabajos) y el
 *     detalle igual mientras el ticket esta `queued`/`analyzing`. Es la parte visible del
 *     «poco a poco»: las lineas que el modelo va soltando aparecen en la ficha segun
 *     llegan, sin recargar nada.
 *  2. El icono de la cabecera no pertenece a una vista: es un servicio singleton con su
 *     propia señal, para que la cola se siga moviendo al navegar entre secciones.
 */

@Injectable({ providedIn: 'root' })
export class ReceiptsService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiUrl = '/api/receipts';

  /** La bandeja completa (estados incluidos). */
  readonly receipts = signal<Receipt[]>([]);
  readonly loading = signal(false);
  readonly history = signal<Receipt[]>([]);
  readonly historyLoading = signal(false);
  readonly historyHasMore = signal(false);
  readonly historyError = signal(false);
  private historyOffset = 0;
  private readonly historyPageSize = 50;
  private historyRetryReset = true;

  /** La ficha abierta y su trabajo. */
  readonly receipt = signal<ReceiptDetail | null>(null);
  readonly loadingReceipt = signal(false);

  /** La cola, para el icono de la cabecera. */
  readonly queue = signal<ReceiptQueueSnapshot>({
    jobs: [],
    counts: { queued: 0, running: 0, failed: 0 }
  });
  readonly queueBusy = signal(false);

  private watching = 0;

  constructor() {
    // El latido de la cola: un tick por segundo MIENTRAS alguien mira. `watching` es un
    // contador de suscriptores (icono de la cabecera + ficha abierta): cuando nadie
    // mira, no hay latido —la cola del server es la que trabaja, el poll solo refleja.
    interval(1000)
      .pipe(
        switchMap(() => (this.watching > 0 ? this.pollQueue() : of(null))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /** Se llama al montar el icono / la ficha: enciende el latido. */
  watch(): void {
    const isFirstWatcher = this.watching === 0;
    this.watching += 1;
    if (isFirstWatcher) {
      this.refreshQueue().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
  }

  unwatch(): void {
    this.watching = Math.max(0, this.watching - 1);
  }

  private pollQueue(): Observable<null> {
    return this.http.get<{ data: ReceiptQueueSnapshot }>(`${this.apiUrl}/queue`).pipe(
      map((response) => {
        this.queue.set(response.data);
        return null;
      }),
      catchError(() => of(null))
    );
  }

  refreshQueue(): Observable<null> {
    return this.pollQueue();
  }

  // ------------------------------------------------------------- la bandeja

  loadReceipts(): void {
    this.loading.set(true);
    this.http
      .get<{ data: Receipt[] }>(`${this.apiUrl}?scope=active&limit=100`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.receipts.set(response.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
  }

  loadHistory(reset = true): void {
    if (this.historyLoading()) return;
    if (!reset && !this.historyHasMore()) return;
    const offset = reset ? 0 : this.historyOffset;
    this.historyRetryReset = reset;
    this.historyError.set(false);
    this.historyLoading.set(true);
    this.http
      .get<ReceiptHistoryPage>(
        `${this.apiUrl}?scope=history&limit=${this.historyPageSize}&offset=${offset}`
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const currentIds = new Set(this.history().map((receipt) => receipt.id));
          this.history.set(
            reset
              ? response.data
              : [
                  ...this.history(),
                  ...response.data.filter((receipt) => !currentIds.has(receipt.id))
                ]
          );
          this.historyOffset = response.pagination.offset + response.data.length;
          this.historyHasMore.set(response.pagination.hasMore);
          this.historyLoading.set(false);
        },
        error: () => {
          this.historyError.set(true);
          this.historyLoading.set(false);
        }
      });
  }

  loadMoreHistory(): void {
    this.loadHistory(false);
  }

  retryHistory(): void {
    this.loadHistory(this.historyError() ? this.historyRetryReset : this.history().length === 0);
  }

  /** Sube un ticket (imagen o PDF, ≤10 MB): entra en la cola y vuelve ya con su id. */
  upload(file: File): Promise<Receipt | null> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.first<Receipt>(
      this.http.post<{ data: Receipt }>(this.apiUrl, body).pipe(map((response) => response.data))
    );
  }

  loadReceipt(id: string): void {
    this.loadingReceipt.set(true);
    this.http
      .get<{ data: ReceiptDetail }>(`${this.apiUrl}/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.receipt.set(response.data);
          this.loadingReceipt.set(false);
        },
        error: () => this.loadingReceipt.set(false)
      });
  }

  /** El poll de la ficha mientras el ticket esta en marcha. */
  refreshReceipt(id: string): Observable<null> {
    return this.http.get<{ data: ReceiptDetail }>(`${this.apiUrl}/${id}`).pipe(
      map((response) => {
        this.receipt.set(response.data);
        return null;
      }),
      catchError(() => of(null))
    );
  }

  updateReceipt(
    id: string,
    input: { store?: string | null; purchaseDate?: string | null; notes?: string | null }
  ): Promise<Receipt | null> {
    return this.first<Receipt>(
      this.http
        .patch<{ data: Receipt }>(`${this.apiUrl}/${id}`, input)
        .pipe(map((response) => response.data))
    ).then((updated) => {
      if (updated) {
        this.receipt.update((current) =>
          current?.id === id ? { ...current, ...updated } : current
        );
        this.receipts.update((current) =>
          current.map((receipt) => (receipt.id === id ? updated : receipt))
        );
        this.history.update((current) =>
          current.map((receipt) => (receipt.id === id ? updated : receipt))
        );
      }
      return updated;
    });
  }

  deleteReceipt(id: string): Promise<unknown> {
    return this.first(this.http.delete<{ data: unknown }>(`${this.apiUrl}/${id}`));
  }

  // ------------------------------------------------------------- las lineas

  addLine(
    id: string,
    input: Partial<ReceiptItem> & { name: string }
  ): Promise<{ id: string } | null> {
    return this.first<{ id: string }>(
      this.http
        .post<{ data: { id: string } }>(`${this.apiUrl}/${id}/items`, input)
        .pipe(map((r) => r.data))
    );
  }

  updateLine(
    id: string,
    itemId: string,
    input: Partial<ReceiptItem>
  ): Promise<{ id: string } | null> {
    return this.first<{ id: string }>(
      this.http
        .patch<{ data: { id: string } }>(`${this.apiUrl}/${id}/items/${itemId}`, input)
        .pipe(map((r) => r.data))
    );
  }

  deleteLine(id: string, itemId: string): Promise<unknown> {
    return this.first(this.http.delete<{ data: unknown }>(`${this.apiUrl}/${id}/items/${itemId}`));
  }

  // ------------------------------------------------------- confirmar / cola

  confirm(id: string): Promise<ReceiptConfirmResult | null> {
    return this.first<ReceiptConfirmResult>(
      this.http
        .post<{ data: ReceiptConfirmResult }>(`${this.apiUrl}/${id}/confirm`, {})
        .pipe(map((r) => r.data))
    );
  }

  stopJob(id: string): Promise<unknown> {
    return this.first(this.http.post<{ data: unknown }>(`${this.apiUrl}/${id}/stop`, {}));
  }

  retryJob(id: string): Promise<unknown> {
    return this.first(this.http.post<{ data: unknown }>(`${this.apiUrl}/${id}/retry`, {}));
  }

  stopAll(): Promise<unknown> {
    this.queueBusy.set(true);
    return this.first(this.http.post<{ data: unknown }>(`${this.apiUrl}/queue/stop`, {})).finally(
      () => this.queueBusy.set(false)
    );
  }

  // ------------------------------------------------------------------ utils

  private async first<T>(source: Observable<T>): Promise<T | null> {
    try {
      return await new Promise<T>((resolve, reject) => {
        const subscription = source.subscribe({
          next: (value) => {
            resolve(value);
            setTimeout(() => subscription.unsubscribe(), 0);
          },
          error: reject
        });
      });
    } catch {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('receipts.error_operacion'));
      return null;
    }
  }
}
