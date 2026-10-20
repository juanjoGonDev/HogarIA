import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { AiFunctionKey } from '../../shared/models/ai-config.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { HouseholdService } from './household.service';

export interface AiProviderAvailability {
  hasActiveProvider: boolean;
  functions: Partial<Record<AiFunctionKey, boolean>>;
  requiresHouseholdSelection: boolean;
}

@Injectable({ providedIn: 'root' })
export class AiProviderAvailabilityService {
  private readonly http = inject(HttpClient);
  private readonly household = inject(HouseholdService);
  private readonly apiUrl = `${environment.apiUrl}/ai/availability`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);
  private request$: Observable<AiProviderAvailability | null> | null = null;
  private requestId = 0;
  private lastContextRevision: number | null = null;

  readonly availability = signal<AiProviderAvailability | null>(null);
  readonly hasActiveProvider = computed(() => this.availability()?.hasActiveProvider === true);
  readonly setupFunction = signal<AiFunctionKey | null>(null);

  constructor() {
    effect(() => {
      const revision = this.household.contextRevision();
      if (this.lastContextRevision === null) {
        this.lastContextRevision = revision;
        return;
      }
      if (this.lastContextRevision === revision) return;

      this.lastContextRevision = revision;
      this.requestId += 1;
      this.request$ = null;
      this.availability.set(null);
      this.setupFunction.set(null);
      this.load(true).subscribe();
    });
  }

  load(force = false): Observable<AiProviderAvailability | null> {
    if (!force && this.availability()) return of(this.availability());
    if (!force && this.request$) return this.request$;

    if (force) this.availability.set(null);
    const requestId = ++this.requestId;
    const contextRevision = this.household.contextRevision();
    const request = this.http
      .get<{ data?: AiProviderAvailability }>(this.apiUrl, { context: this.silentContext })
      .pipe(
        map((response) => response?.data ?? null),
        tap((availability) => {
          if (
            requestId === this.requestId &&
            contextRevision === this.household.contextRevision()
          ) {
            this.availability.set(availability);
          }
        }),
        catchError(() => of(null)),
        finalize(() => {
          if (requestId === this.requestId) this.request$ = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
    this.request$ = request;
    return request;
  }

  isConfigured(functionKey: AiFunctionKey): boolean | null {
    const current = this.availability();
    return current ? current.functions[functionKey] === true : null;
  }

  openSetup(functionKey: AiFunctionKey): void {
    this.setupFunction.set(functionKey);
  }

  closeSetup(): void {
    this.setupFunction.set(null);
  }
}
