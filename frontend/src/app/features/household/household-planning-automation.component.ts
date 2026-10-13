import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import {
  HouseholdPlanningAutomationConflict,
  HouseholdPlanningAutomationRetryError,
  HouseholdPlanningAutomationService,
  type HouseholdPlanningAutomationLastRun,
  type HouseholdPlanningAutomationMode,
  type HouseholdPlanningAutomationRetryFailureCode,
  type HouseholdPlanningAutomationResponse,
  type HouseholdPlanningAutomationRunStatus,
  type HouseholdPlanningAutomationScope
} from '../../core/services/household-planning-automation.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';

interface AutomationDraft {
  mode: HouseholdPlanningAutomationMode | null;
  scopes: HouseholdPlanningAutomationScope[];
  weekday: number | null;
  localTime: string;
  timeZone: string;
}

function sameScopes(
  left: readonly HouseholdPlanningAutomationScope[],
  scopesToMatch: readonly HouseholdPlanningAutomationScope[]
): boolean {
  return (
    left.length === scopesToMatch.length && left.every((scope) => scopesToMatch.includes(scope))
  );
}

const RUN_STATUS_KEYS = new Map<HouseholdPlanningAutomationRunStatus, TranslationKey>([
  ['in_progress', 'household.automation.run_status_in_progress'],
  ['review_required', 'household.automation.run_status_review_required'],
  ['completed', 'household.automation.run_status_completed'],
  ['cancelled', 'household.automation.run_status_cancelled'],
  ['skipped', 'household.automation.run_status_skipped']
]);

function retryErrorTranslation(error: unknown): TranslationKey {
  if (error instanceof HouseholdPlanningAutomationRetryError) {
    return RETRY_ERROR_KEYS.get(error.code) ?? 'household.automation.retry_error';
  }
  return 'household.automation.retry_error';
}

const RETRY_ERROR_KEYS = new Map<HouseholdPlanningAutomationRetryFailureCode, TranslationKey>([
  ['busy', 'household.automation.retry_busy'],
  ['already_completed', 'household.automation.retry_already_completed'],
  ['review_required', 'household.automation.retry_review_required'],
  ['cancelled', 'household.automation.retry_cancelled'],
  ['stale_config', 'household.automation.retry_stale_config'],
  ['authorization_invalid', 'household.automation.retry_authorization_invalid'],
  ['not_authorized', 'household.automation.retry_not_authorized'],
  ['skipped', 'household.automation.retry_skipped'],
  ['not_retryable', 'household.automation.retry_not_retryable'],
  ['not_found', 'household.automation.retry_not_found']
]);

@Component({
  selector: 'app-household-planning-automation',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ButtonComponent, PickerComponent],
  templateUrl: './household-planning-automation.component.html',
  styleUrl: './household-planning-automation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdPlanningAutomationComponent implements OnChanges {
  @Input({ required: true }) householdId = '';
  @Input() canEdit = false;

  private readonly service = inject(HouseholdPlanningAutomationService);
  private readonly i18n = inject(I18nService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private requestId = 0;
  private loadSubscription?: Subscription;
  private saveSubscription?: Subscription;
  private retrySubscription?: Subscription;

  readonly weekdays: ReadonlyArray<{ value: number; label: TranslationKey }> = [
    { value: 1, label: 'household.automation.monday' },
    { value: 2, label: 'household.automation.tuesday' },
    { value: 3, label: 'household.automation.wednesday' },
    { value: 4, label: 'household.automation.thursday' },
    { value: 5, label: 'household.automation.friday' },
    { value: 6, label: 'household.automation.saturday' },
    { value: 7, label: 'household.automation.sunday' }
  ];
  readonly weekdayOptions = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    return this.weekdays.map(({ value, label }) => ({
      value: String(value),
      label: this.i18n.t(label)
    }));
  });

  loading = false;
  saving = false;
  retrying = false;
  retryNeedsRefresh = false;
  loadError = false;
  validationRequested = false;
  versionConflict = false;
  errorKey: TranslationKey | null = null;
  noticeKey: TranslationKey | null = null;
  retryErrorKey: TranslationKey | null = null;
  retryNoticeKey: TranslationKey | null = null;
  response: HouseholdPlanningAutomationResponse | null = null;
  draft: AutomationDraft = emptyDraft();

  get controlsDisabled(): boolean {
    return this.loading || this.saving || this.retrying || !this.canEdit;
  }

  get hasValidSchedule(): boolean {
    return (
      this.draft.mode !== null &&
      this.draft.scopes.length > 0 &&
      this.draft.weekday !== null &&
      this.draft.weekday >= 1 &&
      this.draft.weekday <= 7 &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(this.draft.localTime) &&
      this.hasValidTimeZone
    );
  }

  get weekdayValue(): string | null {
    return this.draft.weekday === null ? null : String(this.draft.weekday);
  }

  get hasValidTimeZone(): boolean {
    return isValidIanaTimeZone(this.draft.timeZone);
  }

  get configurationDirty(): boolean {
    const saved = this.response;
    if (!saved) return false;
    return (
      this.draft.mode !== saved.mode ||
      this.draft.weekday !== saved.weekday ||
      this.draft.localTime !== (saved.localTime ?? '') ||
      this.draft.timeZone !== (saved.timeZone ?? '') ||
      !sameScopes(this.draft.scopes, saved.scopes)
    );
  }

  get canSave(): boolean {
    return Boolean(
      this.canEdit &&
      this.response &&
      this.configurationDirty &&
      !this.loading &&
      !this.saving &&
      !this.versionConflict
    );
  }

  get lastRun(): HouseholdPlanningAutomationLastRun | null {
    return this.response?.lastRun ?? null;
  }

  get canRetryLastRun(): boolean {
    return Boolean(
      this.lastRun?.status === 'review_required' &&
      this.canEdit &&
      !this.loading &&
      !this.saving &&
      !this.retrying &&
      !this.retryNeedsRefresh
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['householdId']) this.load();
  }

  load(): void {
    const requestId = ++this.requestId;
    const householdId = this.householdId;
    this.loadSubscription?.unsubscribe();
    this.saveSubscription?.unsubscribe();
    this.retrySubscription?.unsubscribe();
    this.response = null;
    this.draft = emptyDraft();
    this.errorKey = null;
    this.noticeKey = null;
    this.loadError = false;
    this.validationRequested = false;
    this.versionConflict = false;
    this.saving = false;
    this.retrying = false;
    this.retryNeedsRefresh = false;
    this.retryErrorKey = null;
    this.retryNoticeKey = null;

    if (!householdId) {
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.loadSubscription = this.service
      .load(householdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.acceptResponse(response);
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

  setMode(mode: HouseholdPlanningAutomationMode): void {
    if (this.controlsDisabled) return;
    this.draft.mode = mode;
    this.clearFeedback();
  }

  setScope(scope: HouseholdPlanningAutomationScope, enabled: boolean): void {
    if (this.controlsDisabled) return;
    const selected = new Set(this.draft.scopes);
    if (enabled) selected.add(scope);
    else selected.delete(scope);
    this.draft.scopes = (['tasks', 'meals'] as const).filter((item) => selected.has(item));
    this.clearFeedback();
  }

  setWeekday(value: string | null): void {
    if (this.controlsDisabled) return;
    const weekday = Number(value);
    this.draft.weekday = Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : null;
    this.clearFeedback();
  }

  setLocalTime(value: string): void {
    if (this.controlsDisabled) return;
    this.draft.localTime = value;
    this.clearFeedback();
  }

  setTimeZone(value: string): void {
    if (this.controlsDisabled) return;
    this.draft.timeZone = value;
    this.clearFeedback();
  }

  save(): void {
    if (!this.canSave || !this.response) return;
    this.validationRequested = true;
    this.errorKey = null;
    this.noticeKey = null;
    this.versionConflict = false;
    if (!this.hasValidSchedule) {
      this.cdr.markForCheck();
      return;
    }

    const requestId = this.requestId;
    const householdId = this.householdId;
    this.saving = true;
    this.saveSubscription = this.service
      .save(householdId, {
        expectedVersion: this.response.version,
        mode: this.draft.mode,
        scopes: [...this.draft.scopes],
        weekday: this.draft.weekday,
        localTime: this.draft.localTime,
        timeZone: this.draft.timeZone.trim()
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.acceptResponse(response);
          this.saving = false;
          this.validationRequested = false;
          this.noticeKey = 'household.automation.saved';
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.saving = false;
          if (error instanceof HouseholdPlanningAutomationConflict) {
            this.response = error.snapshot;
            this.versionConflict = true;
            this.errorKey = 'household.automation.version_conflict';
          } else if (isPermissionError(error)) {
            this.errorKey = 'household.automation.permission_error';
          } else {
            this.errorKey = 'household.automation.save_error';
          }
          this.cdr.markForCheck();
        }
      });
  }

  reloadCurrent(): void {
    const current = this.service.snapshotFor(this.householdId);
    if (current) {
      this.acceptResponse(current);
      this.versionConflict = false;
      this.errorKey = null;
      this.validationRequested = false;
      this.cdr.markForCheck();
      return;
    }
    this.load();
  }

  retryLastRun(): void {
    const run = this.lastRun;
    const response = this.response;
    if (!run || !response || !this.canRetryLastRun) return;

    const requestId = this.requestId;
    const householdId = this.householdId;
    this.retrying = true;
    this.retryNeedsRefresh = true;
    this.retryErrorKey = null;
    this.retryNoticeKey = null;
    this.cdr.markForCheck();

    this.retrySubscription = this.service
      .retry(householdId, {
        expectedVersion: response.version,
        occurrenceKey: run.occurrenceKey
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lastRun) => {
          if (!this.isCurrent(requestId, householdId)) return;
          if (this.response) this.response = { ...this.response, lastRun };
          this.refreshRunStatus(requestId, householdId, true);
        },
        error: (error: unknown) => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.retryErrorKey = retryErrorTranslation(error);
          this.refreshRunStatus(requestId, householdId, false);
        }
      });
  }

  refreshRetryState(): void {
    if (this.retrying) return;
    this.retryErrorKey = null;
    this.retryNoticeKey = null;
    this.refreshRunStatus(this.requestId, this.householdId, false);
  }

  runStatusKey(status: HouseholdPlanningAutomationRunStatus): TranslationKey {
    return RUN_STATUS_KEYS.get(status) ?? 'household.automation.run_status_unknown';
  }

  private acceptResponse(response: HouseholdPlanningAutomationResponse): void {
    this.response = response;
    this.draft = {
      mode: response.mode,
      scopes: [...response.scopes],
      weekday: response.weekday,
      localTime: response.localTime ?? '',
      timeZone: response.timeZone ?? ''
    };
    this.versionConflict = false;
  }

  private clearFeedback(): void {
    this.validationRequested = false;
    this.errorKey = null;
    this.noticeKey = null;
    this.cdr.markForCheck();
  }

  private refreshRunStatus(requestId: number, householdId: string, retryAccepted: boolean): void {
    this.retrying = true;
    this.retryNeedsRefresh = true;
    this.retrySubscription = this.service
      .load(householdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.acceptResponse(response);
          this.retrying = false;
          this.retryNeedsRefresh = false;
          if (retryAccepted) this.retryNoticeKey = 'household.automation.retry_accepted';
          this.cdr.markForCheck();
        },
        error: () => {
          if (!this.isCurrent(requestId, householdId)) return;
          this.retrying = false;
          this.retryNeedsRefresh = true;
          this.retryErrorKey = 'household.automation.retry_refresh_error';
          this.cdr.markForCheck();
        }
      });
  }

  private isCurrent(requestId: number, householdId: string): boolean {
    return requestId === this.requestId && householdId === this.householdId;
  }
}

function emptyDraft(): AutomationDraft {
  return { mode: null, scopes: [], weekday: null, localTime: '', timeZone: '' };
}

function isValidIanaTimeZone(value: string): boolean {
  if (!value || value !== value.trim() || /^[+-]\d{2}(?::?\d{2})?$/.test(value)) return false;
  try {
    return Boolean(
      new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
    );
  } catch {
    return false;
  }
}

function isPermissionError(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const code = (error.error as { code?: unknown } | null)?.code;
  return code === 'HOUSEHOLD_SETTINGS_REQUIRED' || code === 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED';
}
