import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { HouseholdMealConsumptionService } from '../../core/services/household-meal-consumption.service';
import type {
  MealConsumptionInput,
  MealConsumptionRecord
} from '../../core/services/household-meal-consumption.service';
import type { CalendarMeal } from '../../shared/models/calendar.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import type { TranslationKey } from '../../core/i18n';

type EditableStatus = 'realized' | 'not_realized';

@Component({
  selector: 'app-calendar-meal-consumption',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, ModalComponent],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="'calendar.consumption.title' | t"
      size="sm"
      [closable]="!saving"
      [closeOnOverlay]="!saving"
      (onClose)="close.emit()"
    >
      <section class="meal-consumption" [attr.aria-label]="'calendar.consumption.title' | t">
        <p class="meal-consumption__meal">{{ meal.title }}</p>

        <p
          *ngIf="loading"
          class="meal-consumption__status"
          data-test="meal-consumption-loading"
          role="status"
          aria-live="polite"
        >
          {{ 'calendar.consumption.loading' | t }}
        </p>

        <div *ngIf="errorKey" class="meal-consumption__error" role="alert" aria-live="assertive">
          <p
            [attr.data-test]="
              versionConflict ? 'meal-consumption-conflict' : 'meal-consumption-error'
            "
          >
            {{ errorKey | t }}
          </p>
          <button
            *ngIf="canReloadAfterError"
            type="button"
            class="cal-btn"
            [attr.data-test]="
              versionConflict ? 'meal-consumption-reload' : 'meal-consumption-retry'
            "
            [disabled]="loading || saving"
            (click)="load()"
          >
            {{
              (versionConflict ? 'calendar.consumption.reload' : 'calendar.consumption.retry') | t
            }}
          </button>
        </div>

        <form
          *ngIf="record && !loading && (!errorKey || canReverseAfterRecipeChange)"
          data-test="meal-consumption-form"
          (ngSubmit)="save()"
        >
          <fieldset [disabled]="saving">
            <legend>{{ 'calendar.consumption.outcome' | t }}</legend>
            <label class="meal-consumption__choice" for="meal-consumption-realized">
              <input
                id="meal-consumption-realized"
                type="radio"
                name="mealConsumptionStatus"
                value="realized"
                [checked]="status === 'realized'"
                [attr.disabled]="canReverseAfterRecipeChange ? '' : null"
                (change)="status = 'realized'"
                data-test="meal-consumption-status-realized"
              />
              <span>{{ 'calendar.consumption.realized' | t }}</span>
            </label>
            <label class="meal-consumption__choice" for="meal-consumption-not-realized">
              <input
                id="meal-consumption-not-realized"
                type="radio"
                name="mealConsumptionStatus"
                value="not_realized"
                [checked]="status === 'not_realized'"
                (change)="status = 'not_realized'"
                data-test="meal-consumption-status-not-realized"
              />
              <span>{{ 'calendar.consumption.not_realized' | t }}</span>
            </label>
          </fieldset>

          <div *ngIf="status === 'realized'" class="meal-consumption__servings">
            <label for="meal-consumption-servings">{{ 'calendar.consumption.servings' | t }}</label>
            <input
              id="meal-consumption-servings"
              type="number"
              name="mealConsumptionServings"
              min="1"
              max="100"
              step="1"
              required
              inputmode="numeric"
              [(ngModel)]="servings"
              [attr.aria-describedby]="'meal-consumption-limit'"
              data-test="meal-consumption-servings"
            />
            <span id="meal-consumption-limit" class="meal-consumption__hint">
              {{ 'calendar.consumption.servings_hint' | t }}
            </span>
          </div>

          <p *ngIf="saving" class="meal-consumption__status" role="status" aria-live="polite">
            {{ 'calendar.consumption.saving' | t }}
          </p>
          <p *ngIf="saved" class="meal-consumption__success" role="status" aria-live="polite">
            {{ 'calendar.consumption.saved' | t }}
          </p>
          <p *ngIf="record.warnings.length" class="meal-consumption__warning" role="status">
            {{ 'calendar.consumption.inventory_warning' | t }}
          </p>

          <div class="meal-consumption__actions">
            <button type="button" class="cal-btn" [disabled]="saving" (click)="close.emit()">
              {{ 'common.cancel' | t }}
            </button>
            <button
              type="submit"
              class="cal-btn cal-btn--primary"
              data-test="meal-consumption-save"
              [disabled]="saving || !canSave()"
            >
              {{ 'calendar.consumption.save' | t }}
            </button>
          </div>
        </form>

        <div *ngIf="!record && !loading && !errorKey" class="meal-consumption__actions">
          <button type="button" class="cal-btn" (click)="close.emit()">
            {{ 'common.cancel' | t }}
          </button>
        </div>
      </section>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .meal-consumption {
        display: grid;
        gap: var(--space-4);
      }

      .meal-consumption__meal,
      .meal-consumption__status,
      .meal-consumption__error p,
      .meal-consumption__success,
      .meal-consumption__warning {
        margin: 0;
      }

      .meal-consumption__meal {
        font-weight: 600;
      }

      .meal-consumption fieldset {
        display: grid;
        gap: var(--space-2);
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }

      .meal-consumption legend,
      .meal-consumption__servings label {
        margin-bottom: var(--space-2);
        font-weight: 600;
      }

      .meal-consumption__choice {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: 40px;
        cursor: pointer;
      }

      .meal-consumption__choice input {
        width: 20px;
        height: 20px;
        margin: 0;
        accent-color: var(--primary);
      }

      .meal-consumption__servings {
        display: grid;
        gap: var(--space-2);
      }

      .meal-consumption__servings input {
        width: 100%;
        min-height: 44px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }

      .meal-consumption__servings input:focus-visible,
      .meal-consumption__choice input:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .meal-consumption__hint {
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .meal-consumption__error {
        display: grid;
        gap: var(--space-3);
        color: var(--danger, #b42318);
      }

      .meal-consumption__success {
        color: var(--success);
      }

      .meal-consumption__warning {
        color: var(--text-secondary);
      }

      .meal-consumption__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--space-2);
        margin-top: var(--space-2);
      }

      .cal-btn {
        min-height: 40px;
      }

      .cal-btn:hover:not(:disabled) {
        color: var(--text-primary);
        border-color: var(--border-strong);
      }

      .cal-btn--primary:hover:not(:disabled) {
        color: var(--text-inverse);
        background: var(--primary-dark);
        border-color: var(--primary-dark);
      }

      .cal-btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      @media (max-width: 480px) {
        .meal-consumption__actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
      }
    `
  ]
})
export class CalendarMealConsumptionComponent implements OnChanges {
  private readonly service = inject(HouseholdMealConsumptionService);
  private readonly destroyRef = inject(DestroyRef);
  private loadSequence = 0;

  @Input({ required: true }) meal!: CalendarMeal;
  @Input({ required: true }) householdId!: string;
  @Output() close = new EventEmitter<void>();

  loading = false;
  saving = false;
  saved = false;
  record: MealConsumptionRecord | null = null;
  status: EditableStatus = 'realized';
  servings: number | null = null;
  errorKey: TranslationKey | null = null;
  versionConflict = false;
  canReloadAfterError = true;
  canReverseAfterRecipeChange = false;

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['meal'] || changes['householdId']) && this.meal?.id && this.householdId) {
      this.load();
    }
  }

  load(): void {
    if (!this.meal?.id || !this.householdId) return;
    const sequence = ++this.loadSequence;
    this.loading = true;
    this.saving = false;
    this.saved = false;
    this.errorKey = null;
    this.versionConflict = false;
    this.canReloadAfterError = true;
    this.canReverseAfterRecipeChange = false;
    this.record = null;
    this.service
      .load(this.meal.id, this.householdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (record) => {
          if (sequence !== this.loadSequence) return;
          this.record = record;
          this.status = record.status === 'not_realized' ? 'not_realized' : 'realized';
          this.servings = record.status === 'realized' ? record.servings : null;
          this.loading = false;
        },
        error: (error: unknown) => {
          if (sequence !== this.loadSequence) return;
          this.loading = false;
          this.errorKey = this.errorMessage(error);
          this.canReloadAfterError = true;
        }
      });
  }

  canSave(): boolean {
    if (!this.record) return false;
    const normalizedServings = this.status === 'realized' ? this.servings : 0;
    const validServings =
      this.status === 'not_realized' ||
      (Number.isInteger(normalizedServings) &&
        normalizedServings! >= 1 &&
        normalizedServings! <= 100);
    const allowedAfterRecipeChange =
      !this.canReverseAfterRecipeChange || this.status === 'not_realized';
    const unchanged =
      this.record.status === this.status && this.record.servings === normalizedServings;
    return validServings && allowedAfterRecipeChange && !unchanged && !this.versionConflict;
  }

  save(): void {
    if (!this.record || !this.canSave() || this.saving) return;
    const input: MealConsumptionInput =
      this.status === 'realized'
        ? {
            status: 'realized',
            servings: this.servings as number,
            expectedVersion: this.record.version
          }
        : { status: 'not_realized', servings: 0, expectedVersion: this.record.version };

    this.saving = true;
    this.saved = false;
    this.errorKey = null;
    this.service
      .save(this.meal.id, this.householdId, input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (record) => {
          this.record = record;
          this.status = record.status === 'not_realized' ? 'not_realized' : 'realized';
          this.servings = record.status === 'realized' ? record.servings : null;
          this.canReverseAfterRecipeChange = false;
          this.saving = false;
          this.saved = true;
        },
        error: (error: unknown) => {
          this.saving = false;
          this.errorKey = this.errorMessage(error);
          const code = this.errorCode(error);
          this.versionConflict = code === 'MEAL_CONSUMPTION_VERSION_CONFLICT';
          this.canReverseAfterRecipeChange = code === 'RECIPE_SNAPSHOT_UNAVAILABLE';
          this.canReloadAfterError =
            this.versionConflict ||
            !['RECIPE_SNAPSHOT_UNAVAILABLE', 'MEAL_CONSUMPTION_INVENTORY_UNIT_CHANGED'].includes(
              code
            );
        }
      });
  }

  private errorMessage(error: unknown): TranslationKey {
    const code = this.errorCode(error);
    if (code === 'MEAL_CONSUMPTION_VERSION_CONFLICT')
      return 'calendar.consumption.version_conflict';
    if (code === 'RECIPE_SNAPSHOT_UNAVAILABLE') return 'calendar.consumption.recipe_changed';
    if (code === 'MEAL_CONSUMPTION_INVENTORY_UNIT_CHANGED')
      return 'calendar.consumption.unit_changed';
    if ((error as HttpErrorResponse)?.status === 403) return 'calendar.consumption.not_allowed';
    return 'calendar.consumption.error';
  }

  private errorCode(error: unknown): string {
    const body = (error as HttpErrorResponse)?.error as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : '';
  }
}
