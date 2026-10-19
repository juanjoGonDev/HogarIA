import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { openResilientStream, type StreamHandle, type StreamStatus } from '../sse';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log';
export type LogSource = 'server' | 'browser';

export interface LogEntry {
  /** Id estable asignado al entrar en la lista: permite seleccionar lineas. */
  id?: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  stack?: string;
  url?: string;
  type?: 'connected' | string;
  total?: number;
}

@Injectable({ providedIn: 'root' })
export class LogService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/logs`;

  private logsSignal = signal<LogEntry[]>([]);
  private connectedSignal = signal(false);
  private autoScrollSignal = signal(true);
  private filterSource = signal<LogSource | 'all'>('all');
  private filterLevel = signal<LogLevel | 'all'>('all');
  private onlyErrorsSignal = signal(false);
  private pausedSignal = signal(false);

  private stream?: StreamHandle;
  private buffer: LogEntry[] = [];
  private flushTimer?: number;
  private seq = 0;

  readonly logs = this.logsSignal.asReadonly();
  readonly connected = this.connectedSignal.asReadonly();
  /**
   * `retrying`/`closed` con `retryIn` es lo que la pantalla enseña en vez de un silencio:
   * «no veo logs» sin causa era lo que obligaba a abrir la terminal del contenedor.
   */
  readonly streamStatus = signal<StreamStatus>('closed');
  readonly retryIn = signal<number | null>(null);
  readonly autoScroll = this.autoScrollSignal.asReadonly();
  readonly paused = this.pausedSignal.asReadonly();
  readonly sourceFilter = this.filterSource.asReadonly();
  readonly levelFilter = this.filterLevel.asReadonly();
  readonly onlyErrors = this.onlyErrorsSignal.asReadonly();

  connect(): void {
    this.disconnect();

    // Load historical logs first
    this.http.get<any>(`${this.apiUrl}?limit=500`).subscribe({
      next: (res) => {
        const entries: LogEntry[] = res?.data?.logs ?? [];
        // Oldest first for terminal scroll
        this.logsSignal.set(entries.reverse().map((e) => this.withId(e)));
      },
      error: () => {
        /* ignore, SSE will still try */
      }
    });

    // Then open an SSE stream for live updates. Con backoff propio: el `EventSource`
    // desnudo reconecta cada segundo para siempre, y eso es lo que reventaba el cupo de
    // peticiones de TODA la casa mientras el visor seguia sin enseñar nada.
    this.stream = openResilientStream(`${this.apiUrl}/stream`, {
      onMessage: (data) => {
        try {
          const entry: LogEntry = JSON.parse(data);
          if (this.pausedSignal()) return;
          this.pushEntry(entry);
        } catch {
          /* ignore bad JSON */
        }
      },
      onStatus: (status, detail) => {
        this.connectedSignal.set(status === 'live');
        this.streamStatus.set(status);
        this.retryIn.set(status === 'retrying' ? detail.retryInMs : null);
      }
    });
  }

  disconnect(): void {
    if (this.stream) {
      this.stream.close();
      this.stream = undefined;
    }
    this.retryIn.set(null);
    this.connectedSignal.set(false);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  setSourceFilter(s: LogSource | 'all'): void {
    this.filterSource.set(s);
  }

  setLevelFilter(l: LogLevel | 'all'): void {
    this.filterLevel.set(l);
  }

  setOnlyErrors(enabled: boolean): void {
    this.onlyErrorsSignal.set(enabled);
  }

  toggleAutoScroll(): void {
    this.autoScrollSignal.update((v) => !v);
  }

  togglePause(): void {
    this.pausedSignal.update((v) => !v);
  }

  clear(): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}`).pipe(tap(() => this.logsSignal.set([])));
  }

  isVisible(entry: LogEntry): boolean {
    if (entry.type === 'connected') return false;
    if (this.onlyErrors() && entry.level !== 'error') return false;
    if (this.filterSource() !== 'all' && entry.source !== this.filterSource()) return false;
    if (this.filterLevel() !== 'all' && entry.level !== this.filterLevel()) return false;
    return true;
  }

  /** Id unico por entrada: la vista lo usa para seleccionar lineas. */
  private withId(entry: LogEntry): LogEntry {
    return entry.id ? entry : { ...entry, id: `log-${++this.seq}` };
  }

  /** Buffer incoming entries so rapid bursts don't cause excessive change detection. */
  private pushEntry(entry: LogEntry): void {
    this.buffer.push(this.withId(entry));
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      const batch = this.buffer.splice(0);
      this.flushTimer = undefined;
      this.logsSignal.update((list) => {
        const merged = [...list, ...batch];
        // Cap at last 1500 entries
        return merged.length > 1500 ? merged.slice(merged.length - 1500) : merged;
      });
    }, 200);
  }
}
