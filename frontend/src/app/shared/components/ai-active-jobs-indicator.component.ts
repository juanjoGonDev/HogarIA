import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { AiActiveJobsService } from '../../core/services/ai-active-jobs.service';
import { I18nService } from '../../core/services/i18n.service';
import { IconComponent } from './ui/icon/icon.component';

@Component({
  selector: 'app-ai-active-jobs-indicator',
  standalone: true,
  imports: [IconComponent],
  template: `
    <span class="ai-active-jobs-host">
      @if (activeCount() > 0) {
        <span class="ai-active-jobs" aria-hidden="true" data-test="ai-active-jobs-indicator">
          <span class="ai-active-jobs__symbol">
            <span class="ai-active-jobs__ring"></span>
            <app-icon name="smart_toy" [size]="20" [label]="null" />
          </span>
          <span class="ai-active-jobs__count">
            {{ activeCount() > 99 ? '99+' : activeCount() }}
          </span>
        </span>
      }
      <span
        class="visually-hidden"
        [attr.role]="activeCount() > 0 ? 'status' : null"
        aria-live="polite"
        aria-atomic="true"
      >
        @if (activeCount() > 0) {
          {{ accessibleLabel() }}
        }
      </span>
    </span>
  `,
  styles: [
    `
      .ai-active-jobs-host {
        position: relative;
        display: inline-flex;
        flex: none;
        align-items: center;
      }

      .ai-active-jobs {
        position: relative;
        display: inline-flex;
        flex: 0 0 44px;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        color: var(--text-secondary);
      }

      .ai-active-jobs__symbol {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        color: var(--primary-dark, var(--primary));
      }

      .ai-active-jobs__ring {
        position: absolute;
        inset: 0;
        border: 2px solid transparent;
        border-top-color: var(--primary);
        border-right-color: var(--primary);
        border-radius: 50%;
        pointer-events: none;
        animation: ai-active-jobs-spin 1.2s linear infinite;
      }

      .ai-active-jobs__count {
        position: absolute;
        top: 1px;
        right: 0;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        background: var(--primary);
        color: #fff;
        font-size: 10px;
        font-weight: var(--font-bold, 700);
        line-height: 16px;
        text-align: center;
      }

      @keyframes ai-active-jobs-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ai-active-jobs__ring {
          animation: none;
        }
      }
    `
  ]
})
export class AiActiveJobsIndicatorComponent implements OnInit, OnDestroy {
  private readonly i18n = inject(I18nService);
  readonly service = inject(AiActiveJobsService);
  private stopWatching: (() => void) | null = null;

  readonly activeCount = computed(() => this.service.jobs().length);
  readonly accessibleLabel = computed(() => {
    this.i18n.changeTick();
    const jobs = this.service.jobs();
    const queued = jobs.filter((job) => job.status === 'queued').length;
    const running = jobs.length - queued;
    return this.i18n.t('ai_activity.active_jobs_label', {
      total: jobs.length,
      queued,
      running
    });
  });

  ngOnInit(): void {
    this.stopWatching = this.service.watch();
  }

  ngOnDestroy(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }
}
