import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  effect,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import {
  HouseholdPlanningAutomationConflict,
  HouseholdPlanningAutomationService,
  type HouseholdPlanningAutomationOccurrence,
  type HouseholdPlanningAutomationResponse
} from '../../core/services/household-planning-automation.service';
import { IconButtonComponent } from './ui/icon-button/icon-button.component';

const WEEKDAY_LABELS: ReadonlyArray<TranslationKey> = [
  'household.automation.monday',
  'household.automation.tuesday',
  'household.automation.wednesday',
  'household.automation.thursday',
  'household.automation.friday',
  'household.automation.saturday',
  'household.automation.sunday'
];

@Component({
  selector: 'app-household-planning-automation-notice',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconButtonComponent],
  template: `
    <section
      *ngIf="visible"
      class="planning-notice"
      role="region"
      [attr.aria-label]="'household.automation.notice_title' | t"
      [attr.aria-busy]="loading || toggling"
      data-test="planning-automation-notice"
    >
      <div class="planning-notice__copy">
        <h2>{{ 'household.automation.notice_title' | t }}</h2>
        <p *ngIf="loading" role="status" aria-live="polite">
          {{ 'household.automation.notice_loading' | t }}
        </p>
        <ng-container *ngIf="!loading && configuredState as config">
          <p *ngIf="config.enabled && config.nextRun as nextRun" role="status" aria-live="polite">
            {{ formatOccurrence(nextRun) }}
          </p>
          <p *ngIf="config.enabled && !config.nextRun" class="planning-notice__error" role="alert">
            {{ 'household.automation.notice_next_unavailable' | t }}
          </p>
          <p *ngIf="!config.enabled" role="status" aria-live="polite">
            {{ 'household.automation.notice_paused' | t }}
          </p>
          <p *ngIf="!config.enabled">
            {{ 'household.automation.notice_paused_schedule' | t: pausedScheduleParams(config) }}
          </p>
        </ng-container>
        <p *ngIf="loadError" class="planning-notice__error" role="alert">
          {{ 'household.automation.notice_load_error' | t }}
        </p>
        <p *ngIf="toggleErrorKey" class="planning-notice__error" role="alert">
          {{ toggleErrorKey | t }}
        </p>
        <p *ngIf="!canManage" class="planning-notice__permission">
          {{ 'household.automation.notice_permission' | t }}
        </p>
        <p
          *ngIf="canManage && configuredState && !configuredState.enabled && !canActivate"
          class="planning-notice__permission"
        >
          {{ 'household.automation.notice_activate_permission' | t }}
        </p>
        <p *ngIf="toggling" role="status" aria-live="polite">
          {{ 'household.automation.notice_toggling' | t }}
        </p>
      </div>
      <app-icon-button
        *ngIf="!loading && configuredState as config"
        [icon]="config.enabled ? 'pause' : 'play_arrow'"
        size="md"
        variant="soft"
        [label]="
          (config.enabled
            ? 'household.automation.notice_pause'
            : 'household.automation.notice_resume'
          ) | t
        "
        [disabled]="toggling || !canManage || (!config.enabled && !canActivate)"
        [loading]="toggling"
        data-test="planning-automation-toggle"
        (onClick)="toggle()"
      />
    </section>
  `,
  styles: [
    `
      :host {
        position: fixed;
        z-index: 90;
        right: max(var(--space-5), env(safe-area-inset-right, 0px));
        bottom: max(var(--space-5), env(safe-area-inset-bottom, 0px));
        width: min(22rem, calc(100vw - 2 * var(--space-4)));
        pointer-events: none;
      }

      .planning-notice {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 40px;
        align-items: center;
        gap: var(--space-3);
        box-sizing: border-box;
        width: 100%;
        min-height: 68px;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        box-shadow: var(--shadow-md);
        pointer-events: auto;
      }

      .planning-notice__copy {
        min-width: 0;
      }

      .planning-notice__copy h2 {
        margin: 0;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        line-height: var(--leading-tight);
      }

      .planning-notice__copy p {
        margin: var(--space-1) 0 0;
        color: var(--text-secondary);
        font-size: var(--text-xs);
        line-height: var(--leading-normal);
        overflow-wrap: anywhere;
      }

      .planning-notice__copy .planning-notice__error {
        color: var(--error);
      }

      .planning-notice__permission {
        color: var(--text-secondary);
      }

      app-icon-button {
        justify-self: end;
      }

      @media (max-width: 767px) {
        :host {
          right: max(var(--space-3), env(safe-area-inset-right, 0px));
          bottom: calc(
            var(--bottom-nav-height) + var(--space-2) + env(safe-area-inset-bottom, 0px)
          );
          left: max(var(--space-3), env(safe-area-inset-left, 0px));
          width: auto;
        }

        .planning-notice {
          min-height: 64px;
        }
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdPlanningAutomationNoticeComponent implements OnChanges {
  @Input({ required: true }) householdId = '';
  @Input() canManage = false;
  @Input() canActivate = false;

  private readonly service = inject(HouseholdPlanningAutomationService);
  private readonly i18n = inject(I18nService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private lastObservedState: HouseholdPlanningAutomationResponse | null = null;
  private requestId = 0;
  private loadSubscription?: Subscription;
  private toggleSubscription?: Subscription;

  loading = false;
  loadError = false;
  toggling = false;
  toggleErrorKey: TranslationKey | null = null;

  constructor() {
    effect(() => {
      const current = this.service.snapshotFor(this.householdId);
      if (current === this.lastObservedState) return;
      this.lastObservedState = current;
      if (this.loadError && current && !this.loading) {
        this.loadError = false;
        this.cdr.markForCheck();
      }
    });
  }

  get state(): HouseholdPlanningAutomationResponse | null {
    return this.service.snapshotFor(this.householdId);
  }

  get configuredState(): HouseholdPlanningAutomationResponse | null {
    const state = this.state;
    return this.isConfigured(state) ? state : null;
  }

  get visible(): boolean {
    return this.loading || this.loadError || this.configuredState !== null;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['householdId']) this.load();
  }

  load(): void {
    const requestId = ++this.requestId;
    const householdId = this.householdId;
    this.loadSubscription?.unsubscribe();
    this.toggleSubscription?.unsubscribe();
    this.toggleErrorKey = null;
    this.loadError = false;
    this.toggling = false;
    if (!householdId) {
      this.loading = false;
      return;
    }

    this.loading = true;
    this.loadSubscription = this.service
      .load(householdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.loading = false;
          this.loadError = true;
          this.cdr.markForCheck();
        }
      });
  }

  toggle(): void {
    const config = this.state;
    if (
      !config ||
      !this.isConfigured(config) ||
      this.toggling ||
      !this.canManage ||
      (!config.enabled && !this.canActivate)
    ) {
      return;
    }

    const requestId = this.requestId;
    const householdId = this.householdId;
    this.toggleErrorKey = null;
    this.toggling = true;
    this.toggleSubscription = this.service
      .save(householdId, { expectedVersion: config.version, enabled: !config.enabled })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.toggling = false;
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.toggling = false;
          this.toggleErrorKey =
            error instanceof HouseholdPlanningAutomationConflict
              ? 'household.automation.version_conflict'
              : 'household.automation.notice_toggle_error';
          this.cdr.markForCheck();
        }
      });
  }

  formatOccurrence(occurrence: HouseholdPlanningAutomationOccurrence): string {
    try {
      const locale = this.i18n.resolved() === 'en' ? 'en-GB' : 'es-ES';
      const label = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: occurrence.timeZone
      }).format(new Date(occurrence.utcInstant));
      return this.i18n.t('household.automation.notice_active', {
        dateTime: label,
        timeZone: occurrence.timeZone
      });
    } catch {
      return this.i18n.t('household.automation.notice_active', {
        dateTime: `${occurrence.localDate} ${occurrence.localTime}`,
        timeZone: occurrence.timeZone
      });
    }
  }

  pausedScheduleParams(config: HouseholdPlanningAutomationResponse): Record<string, string> {
    const day = config.weekday ? this.i18n.t(WEEKDAY_LABELS[config.weekday - 1]) : '';
    return {
      day,
      time: config.localTime ?? '',
      timeZone: config.timeZone ?? ''
    };
  }

  private isConfigured(config: HouseholdPlanningAutomationResponse | null): boolean {
    return Boolean(
      config &&
      config.mode &&
      config.scopes.length > 0 &&
      config.weekday !== null &&
      config.localTime &&
      config.timeZone
    );
  }

  private isCurrent(requestId: number, householdId: string): boolean {
    return requestId === this.requestId && householdId === this.householdId;
  }
}
