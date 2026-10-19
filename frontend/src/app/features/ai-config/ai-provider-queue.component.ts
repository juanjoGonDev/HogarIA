import {
  Component,
  computed,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { AiQueueService } from '../../core/services/ai-queue.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { AIProviderConfig } from '../../shared/models/ai-config.model';
import type {
  AiQueueJob,
  AiQueueJobStatus,
  AiQueueState
} from '../../shared/models/ai-queue.model';
import type { TranslationKey } from '../../core/i18n';

const EMPTY_QUEUE: AiQueueState = {
  snapshot: null,
  loading: false,
  loadError: false,
  mutating: false,
  actionError: false
};

const KIND_KEYS: Record<string, TranslationKey> = {
  receipt: 'ai_config.queue_kind_receipt',
  recipe: 'ai_config.queue_kind_recipe',
  multiple_recipes: 'ai_config.queue_kind_multiple_recipes',
  recommendations: 'ai_config.queue_kind_recommendations',
  weekly_plan: 'ai_config.queue_kind_weekly_plan',
  shopping_photo: 'ai_config.queue_kind_shopping_photo',
  expiry_estimate: 'ai_config.queue_kind_expiry_estimate',
  connection_test: 'ai_config.queue_kind_connection_test'
};

const ERROR_KEYS: Record<string, TranslationKey> = {
  PROVIDER: 'ai_config.queue_error_provider',
  BAD_JSON: 'ai_config.queue_error_bad_json',
  TIMEOUT: 'ai_config.queue_error_timeout',
  INPUT_EXPIRED: 'ai_config.queue_error_input_expired',
  CONFIG_UNAVAILABLE: 'ai_config.queue_error_config_unavailable'
};

@Component({
  selector: 'app-ai-provider-queue',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    @if (config.concurrency > 0) {
      <section
        class="ai-queue"
        [attr.aria-labelledby]="'ai-queue-title-' + config.id"
        [attr.aria-busy]="queueState().loading || queueState().mutating"
        data-test="ai-provider-queue"
      >
        <header class="ai-queue__header">
          <div class="ai-queue__heading">
            <h4 id="ai-queue-title-{{ config.id }}">{{ 'ai_config.queue_title' | t }}</h4>
            <span class="ai-queue__counts">
              {{
                'ai_config.queue_counts'
                  | t
                    : {
                        queued: queuedJobs().length,
                        running: runningJobs().length,
                        failed: failedJobs().length
                      }
              }}
            </span>
          </div>
          <button
            class="ai-queue__icon-button"
            type="button"
            [disabled]="queueState().loading"
            [attr.aria-label]="'ai_config.queue_refresh' | t"
            (click)="refresh()"
            data-test="ai-queue-refresh"
          >
            <app-icon name="refresh" [size]="18" [label]="null" />
          </button>
        </header>

        <div class="ai-queue__live" role="status" aria-live="polite" aria-atomic="true">
          {{ announcement() }}
        </div>

        @if (queueState().loadError) {
          <div class="ai-queue__alert" role="alert" aria-atomic="true">
            <p>{{ 'ai_config.queue_load_error' | t }}</p>
            <button class="ai-queue__text-button" type="button" (click)="refresh()">
              {{ 'ai_config.queue_retry_load' | t }}
            </button>
          </div>
        }

        @if (queueState().actionError) {
          <p class="ai-queue__alert" role="alert" data-test="ai-queue-action-error">
            {{ 'ai_config.queue_action_error' | t }}
          </p>
        }

        @if (queueState().loading && !queueState().snapshot) {
          <p class="ai-queue__state" role="status">{{ 'ai_config.queue_loading' | t }}</p>
        } @else if (queueState().snapshot && queueState().snapshot!.jobs.length === 0) {
          <p class="ai-queue__state" data-test="ai-queue-empty">
            {{ 'ai_config.queue_empty' | t }}
          </p>
        } @else if (queueState().snapshot) {
          @if (queuedJobs().length > 0) {
            <section class="ai-queue__group" [attr.aria-label]="'ai_config.queue_waiting' | t">
              <h5>{{ 'ai_config.queue_waiting' | t }}</h5>
              <p class="ai-queue__hint">{{ 'ai_config.queue_reorder_hint' | t }}</p>
              <ol class="ai-queue__jobs" data-test="ai-queue-waiting-list">
                @for (job of queuedJobs(); track job.id; let index = $index) {
                  <li
                    class="ai-queue__job"
                    tabindex="-1"
                    [attr.data-job-id]="job.id"
                    [attr.data-test]="'ai-queue-job-' + job.status"
                    (dragover)="allowDrop($event)"
                    (drop)="dropJob($event, job)"
                  >
                    <span
                      class="ai-queue__drag-handle"
                      draggable="true"
                      aria-hidden="true"
                      (dragstart)="startDrag($event, job)"
                      (dragend)="draggedJobId.set(null)"
                    >
                      <app-icon name="drag_indicator" [size]="18" [label]="null" />
                    </span>
                    <span class="ai-queue__job-copy">
                      <span class="ai-queue__job-title">{{ kindLabel(job.kind) }}</span>
                      <span class="ai-queue__job-meta">
                        {{ statusLabel(job.status) }} ·
                        {{
                          'ai_config.queue_attempts'
                            | t: { attempts: job.attempts, max: job.maxAttempts }
                        }}
                      </span>
                    </span>
                    <div class="ai-queue__job-actions">
                      <button
                        class="ai-queue__icon-button"
                        type="button"
                        [disabled]="queueState().mutating || queueState().loadError || index === 0"
                        [attr.aria-label]="
                          'ai_config.queue_move_up' | t: { job: kindLabel(job.kind) }
                        "
                        [attr.data-job-id]="job.id"
                        data-action="move-up"
                        (click)="moveBy(job, -1)"
                      >
                        <app-icon name="expand_less" [size]="18" [label]="null" />
                      </button>
                      <button
                        class="ai-queue__icon-button"
                        type="button"
                        [disabled]="
                          queueState().mutating ||
                          queueState().loadError ||
                          index === queuedJobs().length - 1
                        "
                        [attr.aria-label]="
                          'ai_config.queue_move_down' | t: { job: kindLabel(job.kind) }
                        "
                        [attr.data-job-id]="job.id"
                        data-action="move-down"
                        (click)="moveBy(job, 1)"
                      >
                        <app-icon name="expand_more" [size]="18" [label]="null" />
                      </button>
                      <button
                        class="ai-queue__action-button"
                        type="button"
                        [disabled]="queueState().mutating || queueState().loadError"
                        [attr.aria-label]="
                          'ai_config.queue_cancel_job' | t: { job: kindLabel(job.kind) }
                        "
                        [attr.data-job-id]="job.id"
                        (click)="cancel(job)"
                      >
                        <app-icon name="close" [size]="16" [label]="null" />
                        {{ 'ai_config.queue_cancel' | t }}
                      </button>
                    </div>
                  </li>
                }
              </ol>
            </section>
          }

          @if (runningJobs().length > 0) {
            <section class="ai-queue__group" [attr.aria-label]="'ai_config.queue_running' | t">
              <h5>{{ 'ai_config.queue_running' | t }}</h5>
              <ul class="ai-queue__jobs">
                @for (job of runningJobs(); track job.id) {
                  <li
                    class="ai-queue__job"
                    [attr.data-job-id]="job.id"
                    [attr.data-test]="'ai-queue-job-' + job.status"
                  >
                    <span
                      class="ai-queue__status-dot ai-queue__status-dot--running"
                      aria-hidden="true"
                    ></span>
                    <span class="ai-queue__job-copy">
                      <span class="ai-queue__job-title">{{ kindLabel(job.kind) }}</span>
                      <span class="ai-queue__job-meta">{{ statusLabel(job.status) }}</span>
                    </span>
                    <button
                      class="ai-queue__action-button"
                      type="button"
                      [disabled]="queueState().mutating || queueState().loadError"
                      [attr.aria-label]="
                        'ai_config.queue_cancel_job' | t: { job: kindLabel(job.kind) }
                      "
                      [attr.data-job-id]="job.id"
                      (click)="cancel(job)"
                    >
                      <app-icon name="close" [size]="16" [label]="null" />
                      {{ 'ai_config.queue_cancel' | t }}
                    </button>
                  </li>
                }
              </ul>
            </section>
          }

          @if (failedJobs().length > 0) {
            <section class="ai-queue__group" [attr.aria-label]="'ai_config.queue_failed' | t">
              <h5>{{ 'ai_config.queue_failed' | t }}</h5>
              <ul class="ai-queue__jobs">
                @for (job of failedJobs(); track job.id) {
                  <li
                    class="ai-queue__job ai-queue__job--failed"
                    [attr.data-job-id]="job.id"
                    [attr.data-test]="'ai-queue-job-' + job.status"
                  >
                    <span
                      class="ai-queue__status-dot ai-queue__status-dot--failed"
                      aria-hidden="true"
                    ></span>
                    <span class="ai-queue__job-copy">
                      <span class="ai-queue__job-title">{{ kindLabel(job.kind) }}</span>
                      <span class="ai-queue__job-meta">
                        {{ statusLabel(job.status) }} ·
                        {{
                          'ai_config.queue_attempts'
                            | t: { attempts: job.attempts, max: job.maxAttempts }
                        }}
                      </span>
                      @if (job.error) {
                        <span class="ai-queue__job-error">{{ errorLabel(job.error) }}</span>
                      }
                    </span>
                    @if (job.retryable) {
                      <button
                        class="ai-queue__action-button ai-queue__action-button--retry"
                        type="button"
                        [disabled]="queueState().mutating || queueState().loadError"
                        [attr.aria-label]="
                          'ai_config.queue_retry_job' | t: { job: kindLabel(job.kind) }
                        "
                        [attr.data-job-id]="job.id"
                        (click)="retry(job)"
                      >
                        <app-icon name="refresh" [size]="16" [label]="null" />
                        {{ 'ai_config.queue_retry' | t }}
                      </button>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      </section>
    }
  `,
  styles: [
    `
      .ai-queue {
        min-width: 0;
        margin-top: var(--space-4);
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-primary);
      }

      .ai-queue__header,
      .ai-queue__heading,
      .ai-queue__job,
      .ai-queue__job-actions {
        display: flex;
        align-items: center;
      }

      .ai-queue__header {
        justify-content: space-between;
        gap: var(--space-3);
      }

      .ai-queue__heading {
        min-width: 0;
        flex-wrap: wrap;
        gap: var(--space-2);
      }

      .ai-queue__heading h4,
      .ai-queue__group h5 {
        margin: 0;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }

      .ai-queue__counts,
      .ai-queue__job-meta {
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }

      .ai-queue__hint {
        margin: var(--space-1) 0 0;
        color: var(--text-tertiary);
        font-size: var(--text-xs);
      }

      .ai-queue__group {
        min-width: 0;
        margin-top: var(--space-3);
      }

      .ai-queue__jobs {
        display: grid;
        gap: var(--space-2);
        margin: var(--space-2) 0 0;
        padding: 0;
        list-style: none;
      }

      .ai-queue__job {
        min-width: 0;
        gap: var(--space-2);
        padding: var(--space-2);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
      }

      .ai-queue__job:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .ai-queue__job--failed {
        border-color: var(--error);
      }

      .ai-queue__job-copy {
        display: grid;
        flex: 1;
        min-width: 0;
        gap: 2px;
      }

      .ai-queue__job-title,
      .ai-queue__job-error {
        overflow-wrap: anywhere;
      }

      .ai-queue__job-title {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .ai-queue__job-error {
        color: var(--error);
        font-size: var(--text-xs);
      }

      .ai-queue__job-actions {
        flex: none;
        gap: 2px;
      }

      .ai-queue__icon-button,
      .ai-queue__action-button,
      .ai-queue__text-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-1);
        min-width: 44px;
        min-height: 44px;
        padding: 0 var(--space-2);
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        background: transparent;
        font: inherit;
        cursor: pointer;
      }

      .ai-queue__action-button,
      .ai-queue__text-button {
        font-size: var(--text-xs);
        white-space: nowrap;
      }

      .ai-queue__action-button--retry {
        color: var(--primary);
      }

      .ai-queue__icon-button:hover:not(:disabled),
      .ai-queue__action-button:hover:not(:disabled),
      .ai-queue__text-button:hover {
        border-color: var(--border-strong);
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      .ai-queue__icon-button:focus-visible,
      .ai-queue__action-button:focus-visible,
      .ai-queue__text-button:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .ai-queue__icon-button:disabled,
      .ai-queue__action-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .ai-queue__drag-handle {
        display: inline-flex;
        flex: none;
        padding: var(--space-1);
        color: var(--text-tertiary);
        cursor: grab;
        touch-action: none;
      }

      .ai-queue__drag-handle:active {
        cursor: grabbing;
      }

      .ai-queue__status-dot {
        width: 10px;
        height: 10px;
        flex: none;
        border-radius: 50%;
        background: var(--text-tertiary);
      }

      .ai-queue__status-dot--running {
        background: var(--primary);
      }

      .ai-queue__status-dot--failed {
        background: var(--error);
      }

      .ai-queue__state,
      .ai-queue__alert {
        margin: var(--space-3) 0 0;
        font-size: var(--text-sm);
      }

      .ai-queue__alert {
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        background: var(--error-subtle);
      }

      .ai-queue__alert p {
        margin: 0;
      }

      .ai-queue__live {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        clip-path: inset(50%);
      }

      @media (max-width: 480px) {
        .ai-queue {
          padding: var(--space-3);
        }

        .ai-queue__job {
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .ai-queue__job-copy {
          flex-basis: calc(100% - 56px);
        }

        .ai-queue__job-actions {
          justify-content: flex-end;
          width: 100%;
        }
      }
    `
  ]
})
export class AiProviderQueueComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) config!: AIProviderConfig;

  readonly queueState = computed(() => {
    const id = this.configId();
    return id ? this.queueService.stateFor(id)() : EMPTY_QUEUE;
  });
  readonly queuedJobs = computed(() =>
    (this.queueState().snapshot?.jobs ?? [])
      .filter((job) => job.status === 'queued')
      .slice()
      .sort((a, b) => a.queueOrder - b.queueOrder)
  );
  readonly runningJobs = computed(() =>
    (this.queueState().snapshot?.jobs ?? []).filter((job) => job.status === 'running')
  );
  readonly failedJobs = computed(() =>
    (this.queueState().snapshot?.jobs ?? []).filter((job) => job.status === 'failed')
  );
  readonly announcement = signal('');
  readonly draggedJobId = signal<string | null>(null);

  private readonly configId = signal('');
  private stopWatching?: () => void;

  constructor(
    private readonly queueService: AiQueueService,
    private readonly i18n: I18nService,
    private readonly host: ElementRef<HTMLElement>
  ) {}

  ngOnChanges(): void {
    if (this.configId() !== this.config.id) {
      this.stopWatching?.();
      this.stopWatching = undefined;
      this.configId.set(this.config.id);
    }
    if (this.config.concurrency > 0 && !this.stopWatching) {
      this.stopWatching = this.queueService.watch(this.config.id);
    } else if (this.config.concurrency <= 0) {
      this.stopWatching?.();
      this.stopWatching = undefined;
    }
  }

  ngOnDestroy(): void {
    this.stopWatching?.();
  }

  kindLabel(kind: string): string {
    const key = KIND_KEYS[kind];
    return this.i18n.t(key ?? 'ai_config.queue_kind_unknown');
  }

  errorLabel(code: string | null): string {
    return this.i18n.t(ERROR_KEYS[code ?? ''] ?? 'ai_config.queue_error_unknown');
  }

  statusLabel(status: AiQueueJobStatus): string {
    const keys: Record<AiQueueJobStatus, TranslationKey> = {
      queued: 'ai_config.queue_status_queued',
      running: 'ai_config.queue_status_running',
      failed: 'ai_config.queue_status_failed'
    };
    return this.i18n.t(keys[status]);
  }

  refresh(): void {
    this.queueService.refreshQueue(this.config.id).subscribe((snapshot) => {
      this.announcement.set(
        this.i18n.t(snapshot ? 'ai_config.queue_refreshed' : 'ai_config.queue_load_error')
      );
    });
  }

  moveBy(job: AiQueueJob, offset: -1 | 1): void {
    const jobs = this.queuedJobs();
    const currentIndex = jobs.findIndex((candidate) => candidate.id === job.id);
    const destinationIndex = currentIndex + offset;
    if (currentIndex < 0 || destinationIndex < 0 || destinationIndex >= jobs.length) return;
    const reordered = jobs.slice();
    reordered.splice(currentIndex, 1);
    reordered.splice(destinationIndex, 0, job);
    this.saveOrder(
      reordered.map((item) => item.id),
      job.id
    );
  }

  startDrag(event: DragEvent, job: AiQueueJob): void {
    if (this.queueState().mutating || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    this.draggedJobId.set(job.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', job.id);
  }

  allowDrop(event: DragEvent): void {
    if (!this.queueState().mutating && this.draggedJobId()) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
  }

  dropJob(event: DragEvent, target: AiQueueJob): void {
    event.preventDefault();
    const movingId = event.dataTransfer?.getData('text/plain') || this.draggedJobId();
    this.draggedJobId.set(null);
    if (!movingId || movingId === target.id || target.status !== 'queued') return;

    const jobs = this.queuedJobs();
    const from = jobs.findIndex((job) => job.id === movingId);
    const to = jobs.findIndex((job) => job.id === target.id);
    if (from < 0 || to < 0) return;
    const reordered = jobs.slice();
    const [moving] = reordered.splice(from, 1);
    reordered.splice(to, 0, moving);
    this.saveOrder(
      reordered.map((job) => job.id),
      movingId
    );
  }

  cancel(job: AiQueueJob): void {
    this.queueService.cancel(this.config.id, job.id).subscribe((success) => {
      this.announcement.set(
        this.i18n.t(success ? 'ai_config.queue_cancelled' : 'ai_config.queue_action_error')
      );
      if (success) this.restoreFocus(job.id);
    });
  }

  retry(job: AiQueueJob): void {
    this.queueService.retry(this.config.id, job.id).subscribe((success) => {
      this.announcement.set(
        this.i18n.t(success ? 'ai_config.queue_retried' : 'ai_config.queue_action_error')
      );
      if (success) this.restoreFocus(job.id);
    });
  }

  private saveOrder(jobIds: string[], focusJobId: string): void {
    this.queueService.reorder(this.config.id, jobIds).subscribe((success) => {
      this.announcement.set(
        this.i18n.t(success ? 'ai_config.queue_reordered' : 'ai_config.queue_action_error')
      );
      if (success) this.restoreFocus(focusJobId);
    });
  }

  private restoreFocus(jobId: string): void {
    // Let Angular render the reordered list first: the previously focused move button
    // may become disabled at its new position and the browser would otherwise blur it.
    requestAnimationFrame(() => {
      const candidates =
        this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button[data-job-id]');
      const action = Array.from(candidates).find(
        (button) => button.dataset['jobId'] === jobId && !button.disabled
      );
      const row = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>('.ai-queue__job[data-job-id]')
      ).find((element) => element.dataset['jobId'] === jobId);
      const refresh = this.host.nativeElement.querySelector<HTMLButtonElement>(
        '[data-test="ai-queue-refresh"]'
      );
      (action ?? row ?? refresh)?.focus();
    });
  }
}
