import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { TranslationKey } from '../../core/i18n';
import { MEAL_LABEL_KEYS } from '../../core/i18n/labels';
import { HouseholdMealPlanningService } from '../../core/services/household-meal-planning.service';
import type {
  HouseholdMealPlanningPatch,
  HouseholdMealPlanningSettings,
  MealPlanningObjective,
  MealPlanningSchedule
} from '../../core/services/household-meal-planning.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CheckboxComponent } from '../../shared/components/ui/checkbox/checkbox.component';
import { SwitchComponent } from '../../shared/components/ui/switch/switch.component';
import {
  MEAL_ORDER,
  type MealPlan,
  type MealTimes,
  type MealType
} from '../../shared/models/calendar.model';
import {
  GOAL_LABEL_KEYS,
  GOAL_OPTIONS,
  type TasteGoal,
  toggleTasteGoal
} from '../../shared/models/taste-profile';

type SettingsScope = 'household' | 'member';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-household-meal-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    ButtonComponent,
    CheckboxComponent,
    SwitchComponent
  ],
  templateUrl: './household-meal-settings.component.html',
  styleUrl: './household-meal-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdMealSettingsComponent implements OnChanges {
  @Input({ required: true }) householdId = '';
  @Input() canEdit = false;

  private readonly service = inject(HouseholdMealPlanningService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private loadSubscription?: Subscription;
  private saveSubscription?: Subscription;
  private baseline: HouseholdMealPlanningSettings | null = null;

  readonly mealRows = MEAL_ORDER.map((type) => ({
    type,
    labelKey: MEAL_LABEL_KEYS[type]
  }));
  readonly goalOptions = GOAL_OPTIONS;
  readonly goalLabels = GOAL_LABEL_KEYS;

  loadState: LoadState = 'idle';
  loading = false;
  saving = false;
  saveErrorKey: TranslationKey | null = null;
  noticeKey: TranslationKey | null = null;
  settings: HouseholdMealPlanningSettings | null = null;
  householdObjective: MealPlanningObjective = { goals: ['balanced'], notes: '' };
  householdSchedule: MealPlanningSchedule = {
    mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
  };
  goalOverrideEnabled = false;
  scheduleOverrideEnabled = false;
  personalSchedule: MealPlanningSchedule = {
    mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
    mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
  };

  get controlsDisabled(): boolean {
    return this.loading || this.saving;
  }

  get householdDirty(): boolean {
    return Boolean(
      this.canEdit &&
      this.baseline &&
      !sameValue(
        {
          objective: this.householdObjective,
          mealTypes: this.householdSchedule.mealTypes,
          mealTimes: this.householdSchedule.mealTimes
        },
        this.baseline.household
      )
    );
  }

  get memberDirty(): boolean {
    const baseline = this.baseline?.member;
    return Boolean(
      baseline &&
      (this.goalOverrideEnabled !== baseline.goalOverrideEnabled ||
        this.scheduleOverrideEnabled !== baseline.scheduleOverrideEnabled ||
        !sameValue(this.personalSchedule, baseline.personalSchedule))
    );
  }

  get canSave(): boolean {
    return (
      !this.controlsDisabled && (this.householdDirty || this.memberDirty) && !this.hasInvalidTime
    );
  }

  get hasInvalidTime(): boolean {
    return Boolean(
      (this.householdDirty && !hasValidTimes(this.householdSchedule.mealTimes)) ||
      (this.scheduleOverrideEnabled && !hasValidTimes(this.personalSchedule.mealTimes))
    );
  }

  isInvalidTime(scope: SettingsScope, type: MealType): boolean {
    if (scope === 'household' && this.canEdit && this.householdDirty) {
      return !isValidTime(this.householdSchedule.mealTimes[type]);
    }
    if (scope === 'member' && this.scheduleOverrideEnabled) {
      return !isValidTime(this.personalSchedule.mealTimes[type]);
    }
    return false;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['householdId']) this.load();
  }

  load(): void {
    this.generation += 1;
    const generation = this.generation;
    const householdId = this.householdId;
    this.loadSubscription?.unsubscribe();
    this.saveSubscription?.unsubscribe();
    this.baseline = null;
    this.settings = null;
    this.saveErrorKey = null;
    this.noticeKey = null;
    this.saving = false;
    if (!householdId) {
      this.loading = false;
      this.loadState = 'idle';
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.loadState = 'loading';
    this.loadSubscription = this.service
      .load(householdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          if (!this.isCurrent(generation, householdId)) return;
          this.acceptSettings(settings);
          this.loading = false;
          this.loadState = 'ready';
          this.cdr.markForCheck();
        },
        error: () => {
          if (!this.isCurrent(generation, householdId)) return;
          this.loading = false;
          this.loadState = 'error';
          this.cdr.markForCheck();
        }
      });
  }

  toggleHouseholdGoal(goal: TasteGoal, enabled: boolean): void {
    if (!this.canEdit || this.controlsDisabled) return;
    this.householdObjective.goals = toggleGoals(this.householdObjective.goals, goal, enabled);
  }

  setHouseholdNotes(value: string): void {
    if (this.canEdit && !this.controlsDisabled) this.householdObjective.notes = value;
  }

  setGoalOverride(enabled: boolean): void {
    if (!this.controlsDisabled) this.goalOverrideEnabled = enabled;
  }

  setScheduleOverride(enabled: boolean): void {
    if (!this.controlsDisabled) this.scheduleOverrideEnabled = enabled;
  }

  setMealType(scope: SettingsScope, type: MealType, enabled: boolean): void {
    if (this.controlsDisabled) return;
    if (scope === 'household') {
      if (this.canEdit) this.householdSchedule.mealTypes[type] = enabled;
    } else if (this.scheduleOverrideEnabled) {
      this.personalSchedule.mealTypes[type] = enabled;
    }
  }

  setMealTime(scope: SettingsScope, type: MealType, time: string): void {
    if (this.controlsDisabled) return;
    if (scope === 'household') {
      if (this.canEdit) this.householdSchedule.mealTimes[type] = time;
    } else if (this.scheduleOverrideEnabled) {
      this.personalSchedule.mealTimes[type] = time;
    }
  }

  trackMeal(_index: number, row: { type: MealType }): MealType {
    return row.type;
  }

  trackGoalOption(_index: number, option: (typeof GOAL_OPTIONS)[number]): TasteGoal {
    return option.value;
  }

  trackGoal(_index: number, goal: TasteGoal): TasteGoal {
    return goal;
  }

  save(): void {
    const patch = this.buildPatch();
    if (!this.householdId || !patch || !this.baseline || this.controlsDisabled) return;

    const householdId = this.householdId;
    const generation = this.generation;
    this.saving = true;
    this.saveErrorKey = null;
    this.noticeKey = null;
    this.saveSubscription = this.service
      .save(householdId, patch)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          if (!this.isCurrent(generation, householdId)) return;
          this.acceptSettings(settings);
          this.saving = false;
          this.noticeKey = 'ui.guardado';
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          if (!this.isCurrent(generation, householdId)) return;
          this.saving = false;
          this.saveErrorKey = isHouseholdContextChanged(error)
            ? 'household.meal_settings_context_changed'
            : 'household.meal_settings_save_error';
          this.cdr.markForCheck();
        }
      });
  }

  private buildPatch(): HouseholdMealPlanningPatch | null {
    if (!this.baseline) return null;
    const patch: HouseholdMealPlanningPatch = {};

    if (this.householdDirty) {
      const household: NonNullable<HouseholdMealPlanningPatch['household']> = {};
      const objective: NonNullable<
        NonNullable<HouseholdMealPlanningPatch['household']>['objective']
      > = {};
      if (!sameValue(this.householdObjective.goals, this.baseline.household.objective.goals)) {
        objective.goals = [...this.householdObjective.goals];
      }
      if (this.householdObjective.notes !== this.baseline.household.objective.notes) {
        objective.notes = this.householdObjective.notes;
      }
      if (Object.keys(objective).length) household.objective = objective;
      const changedTypes = changedFields(
        this.householdSchedule.mealTypes,
        this.baseline.household.mealTypes
      );
      if (Object.keys(changedTypes).length) household.mealTypes = changedTypes;
      const changedTimes = changedFields(
        this.householdSchedule.mealTimes,
        this.baseline.household.mealTimes
      );
      if (Object.keys(changedTimes).length) household.mealTimes = changedTimes;
      if (Object.keys(household).length) patch.household = household;
    }

    if (this.memberDirty) {
      const member: NonNullable<HouseholdMealPlanningPatch['member']> = {};
      if (this.goalOverrideEnabled !== this.baseline.member.goalOverrideEnabled) {
        member.goalOverrideEnabled = this.goalOverrideEnabled;
      }
      if (this.scheduleOverrideEnabled !== this.baseline.member.scheduleOverrideEnabled) {
        member.scheduleOverrideEnabled = this.scheduleOverrideEnabled;
      }
      if (this.scheduleOverrideEnabled) {
        // Saving an enabled override confirms the full visible schedule. Persist the complete
        // snapshot so proposal generation never treats read-time defaults as personal choices.
        member.schedule = {
          mealTypes: { ...this.personalSchedule.mealTypes },
          mealTimes: { ...this.personalSchedule.mealTimes }
        };
      }
      if (Object.keys(member).length) patch.member = member;
    }

    return Object.keys(patch).length ? patch : null;
  }

  private acceptSettings(settings: HouseholdMealPlanningSettings): void {
    this.settings = settings;
    this.baseline = clone(settings);
    this.householdObjective = clone(settings.household.objective);
    this.householdSchedule = {
      mealTypes: clone(settings.household.mealTypes),
      mealTimes: clone(settings.household.mealTimes)
    };
    this.goalOverrideEnabled = settings.member.goalOverrideEnabled;
    this.scheduleOverrideEnabled = settings.member.scheduleOverrideEnabled;
    this.personalSchedule = {
      mealTypes: clone(settings.member.personalSchedule.mealTypes),
      mealTimes: clone(settings.member.personalSchedule.mealTimes)
    };
  }

  private isCurrent(generation: number, householdId: string): boolean {
    return generation === this.generation && householdId === this.householdId;
  }
}

function toggleGoals(goals: TasteGoal[], goal: TasteGoal, enabled: boolean): TasteGoal[] {
  const currentlySelected = goals.includes(goal);
  if (currentlySelected === enabled) return goals;
  const next = toggleTasteGoal(goals, goal);
  return next.length ? next : ['balanced'];
}

function changedFields<T extends Record<string, boolean | string>>(
  current: T,
  baseline: T
): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(current) as (keyof T)[]) {
    if (current[key] !== baseline[key]) changed[key] = current[key];
  }
  return changed;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasValidTimes(times: MealTimes): boolean {
  return MEAL_ORDER.every((type) => isValidTime(times[type]));
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isHouseholdContextChanged(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  return error.error?.code === 'HOUSEHOLD_CONTEXT_CHANGED';
}
