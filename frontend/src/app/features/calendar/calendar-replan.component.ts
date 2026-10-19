import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, Subscription } from 'rxjs';
import { AiService } from '../../core/services/ai.service';
import { CalendarService } from '../../core/services/calendar.service';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { dateLocale } from '../../core/time';
import type {
  AIReplacementCandidate,
  AIGuestPreferences
} from '../../shared/models/ai-config.model';
import { CalendarMeal, MealType } from '../../shared/models/calendar.model';
import { CheckboxComponent } from '../../shared/components/ui/checkbox/checkbox.component';
import { AiParticipantsComponent } from '../../shared/components/ai-participants.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { GOAL_OPTIONS, TasteGoal, toggleTasteGoal } from '../../shared/models/taste-profile';
import { MEAL_LABEL_KEYS } from '../../core/i18n/labels';

interface ReplanDay {
  date: string;
  meals: CalendarMeal[];
}

interface ReplanDraft {
  id: string;
  date: string;
  mealType: MealType;
  originalTitle: string;
  name: string;
  description: string;
  ingredients: string[];
  estimatedTime: number;
  servings: number;
}

@Component({
  selector: 'app-calendar-replan',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    CheckboxComponent,
    AiParticipantsComponent,
    ModalComponent,
    IconComponent
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="'calendar.replan_title' | t"
      size="xl"
      [closable]="!isApplying()"
      [closeOnOverlay]="!isApplying()"
      (onClose)="close()"
    >
      <div class="replan" data-test="calendar-replan-modal">
        <p class="cal-muted">{{ 'calendar.replan_intro' | t: { period: weekLabel() } }}</p>

        <app-ai-participants
          [members]="contextChanged() ? [] : householdService.household()?.members ?? []"
          [selectedMemberIds]="selectedMemberIds()"
          (selectedMemberIdsChange)="updateMembers($event)"
          [guests]="guests()"
          (guestsChange)="updateGuests($event)"
        />

        <fieldset class="replan__section" data-test="replan-goals">
          <legend>{{ 'calendar.objetivo' | t }}</legend>
          <p class="cal-hint">{{ 'calendar.sirven_de_punto_de' | t }}</p>
          <div class="goals-form__options">
            <button
              *ngFor="let goal of goalOptions"
              type="button"
              class="goal-option"
              [class.goal-option--selected]="goalTypes().includes(goal.value)"
              [attr.aria-pressed]="goalTypes().includes(goal.value)"
              [attr.data-test]="'replan-goal-' + goal.value"
              (click)="toggleGoal(goal.value)"
            >
              <span class="goal-option__icon" aria-hidden="true">
                <app-icon [name]="goal.icon" [size]="18" [label]="null" />
              </span>
              <span class="goal-option__label">{{ goal.labelKey | t }}</span>
            </button>
          </div>
          <label *ngIf="goalTypes().includes('custom')" class="replan__field">
            <span>{{ 'calendar.describe_tu_objetivo' | t }}</span>
            <textarea
              name="replanCustomGoal"
              rows="3"
              maxlength="2000"
              [(ngModel)]="customInstructions"
              (ngModelChange)="resetCandidatePreview()"
              [disabled]="isGenerating() || isApplying()"
              class="cal-input cal-input--area"
              data-test="replan-custom-goal"
            ></textarea>
          </label>
          <label class="replan__field replan__calories">
            <span>{{ 'calendar.calorias_diarias_opcional' | t }}</span>
            <input
              type="number"
              min="800"
              max="6000"
              step="50"
              [(ngModel)]="caloriesTarget"
              (ngModelChange)="resetCandidatePreview()"
              [disabled]="isGenerating() || isApplying()"
              class="cal-input"
              data-test="replan-calories"
            />
          </label>
        </fieldset>

        <section class="replan__section" aria-labelledby="replan-selection-title">
          <div class="replan__heading">
            <div>
              <h3 id="replan-selection-title">{{ 'calendar.replan_select_title' | t }}</h3>
              <p class="cal-hint">
                {{ 'calendar.replan_selection_count' | t: { count: selectedMeals().length } }}
              </p>
            </div>
            <div class="replan__bulk-actions">
              <button
                type="button"
                class="cal-btn"
                [disabled]="isLoadingMeals() || isGenerating() || isApplying()"
                (click)="selectAll()"
              >
                {{ 'calendar.replan_select_all' | t }}
              </button>
              <button
                type="button"
                class="cal-btn"
                [disabled]="isGenerating() || isApplying()"
                (click)="deselectAll()"
              >
                {{ 'calendar.replan_clear_selection' | t }}
              </button>
            </div>
          </div>

          <p *ngIf="isLoadingMeals()" class="cal-hint" role="status" aria-live="polite">
            {{ 'calendar.replan_loading' | t }}
          </p>
          <p *ngIf="loadFailed()" class="replan__error" role="alert">
            {{ 'calendar.replan_load_failed' | t }}
          </p>
          <p *ngIf="!isLoadingMeals() && !loadFailed() && meals().length === 0" class="cal-muted">
            {{ 'calendar.replan_no_meals' | t }}
          </p>

          <div
            *ngFor="let day of days(); trackBy: trackDay"
            class="replan__day"
            [attr.data-test]="'replan-day-' + day.date"
          >
            <div class="replan__day-title">
              <h4>{{ formatDate(day.date) }}</h4>
              <app-checkbox
                [label]="'calendar.replan_select_day' | t"
                [checked]="isDaySelected(day)"
                [disabled]="isGenerating() || isApplying() || !eligibleMeals(day).length"
                (checkedChange)="toggleDay(day, $event)"
              />
            </div>
            <label
              *ngFor="let meal of day.meals; trackBy: trackMeal"
              class="replan__meal"
              [class.replan__meal--done]="meal.completed"
            >
              <input
                type="checkbox"
                [checked]="selectedIds().includes(meal.id)"
                [disabled]="meal.completed || isGenerating() || isApplying()"
                [attr.aria-label]="
                  'calendar.replan_select_meal'
                    | t: { meal: meal.title, date: formatDate(day.date) }
                "
                [attr.data-test]="'replan-meal-' + meal.id"
                (change)="toggleMeal(meal.id, $any($event.target).checked)"
              />
              <span class="replan__meal-main">
                <strong>{{ mealLabel(meal.mealType) }}</strong>
                <span>{{ meal.title }}</span>
              </span>
              <span class="replan__meal-meta">
                <span *ngIf="meal.time">{{ meal.time }}</span>
                <span>{{ 'calendar.raciones' | t }}: {{ meal.servings }}</span>
                <span *ngIf="meal.completed">{{ 'calendar.replan_completed' | t }}</span>
              </span>
            </label>
          </div>
        </section>

        <section
          *ngIf="drafts().length"
          class="replan__section"
          aria-labelledby="replan-preview-title"
          data-test="replan-preview"
        >
          <h3 id="replan-preview-title">{{ 'calendar.replan_preview_title' | t }}</h3>
          <p class="cal-hint">{{ 'calendar.replan_preview_hint' | t }}</p>
          <article
            *ngFor="let draft of drafts(); trackBy: trackDraft"
            class="replan__draft"
            [attr.data-test]="'replan-draft-' + draft.id"
          >
            <div class="replan__draft-heading">
              <strong>{{ formatDate(draft.date) }} · {{ mealLabel(draft.mealType) }}</strong>
              <span>{{ draft.originalTitle }}</span>
            </div>
            <label class="replan__field">
              <span>{{ 'calendar.replan_candidate_name' | t }}</span>
              <input
                class="cal-input"
                [(ngModel)]="draft.name"
                maxlength="120"
                [disabled]="isApplying()"
              />
            </label>
            <p>{{ draft.description }}</p>
            <p class="cal-hint">
              {{
                'calendar.replacement_candidate_details'
                  | t
                    : {
                        ingredients: draft.ingredients.join(', '),
                        time: draft.estimatedTime,
                        servings: draft.servings
                      }
              }}
            </p>
          </article>
        </section>

        <p
          *ngIf="failed()"
          class="replan__error"
          role="alert"
          aria-live="assertive"
          data-test="replan-error"
        >
          {{ 'calendar.replan_failed' | t }}
        </p>
        <p *ngIf="contextChanged()" class="replan__error" role="alert">
          {{ 'calendar.replan_context_changed' | t }}
        </p>

        <div class="meal-form__actions replan__actions">
          <span class="meal-form__grow"></span>
          <button type="button" class="cal-btn" [disabled]="isApplying()" (click)="close()">
            {{ 'common.cancel' | t }}
          </button>
          <button
            *ngIf="!drafts().length"
            type="button"
            class="cal-btn cal-btn--primary"
            [disabled]="!canGenerate()"
            [attr.aria-busy]="isGenerating()"
            data-test="replan-generate"
            (click)="requestAlternatives()"
          >
            {{
              isGenerating() ? ('calendar.replan_generating' | t) : ('calendar.replan_generate' | t)
            }}
          </button>
          <ng-container *ngIf="drafts().length">
            <button
              type="button"
              class="cal-btn"
              [disabled]="isApplying() || isGenerating()"
              (click)="requestAlternatives()"
            >
              {{ 'calendar.replan_generate_again' | t }}
            </button>
            <button
              type="button"
              class="cal-btn cal-btn--primary"
              [disabled]="!canApply()"
              [attr.aria-busy]="isApplying()"
              data-test="replan-apply"
              (click)="applyAlternatives()"
            >
              {{
                isApplying()
                  ? ('ui.guardando' | t)
                  : ('calendar.replan_apply' | t: { count: drafts().length })
              }}
            </button>
          </ng-container>
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .replan {
        display: grid;
        gap: var(--space-4);
        min-width: 0;
      }
      .replan__section {
        display: grid;
        gap: var(--space-3);
        min-width: 0;
        margin: 0;
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
      }
      .replan__section legend {
        padding: 0 var(--space-1);
        font-weight: var(--font-semibold);
      }
      .replan__section h3,
      .replan__section h4,
      .replan__section p {
        margin: 0;
      }
      .goal-option:hover {
        border-color: var(--border-strong);
        background: var(--bg-tertiary);
      }
      .goal-option:focus-visible,
      .cal-btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
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
      .replan__heading,
      .replan__day-title,
      .replan__draft-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        min-width: 0;
      }
      .replan__bulk-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--space-2);
      }
      .replan__day {
        display: grid;
        gap: var(--space-2);
        padding-top: var(--space-3);
        border-top: 1px solid var(--border-default);
      }
      .replan__day-title h4 {
        text-transform: capitalize;
      }
      .replan__meal {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-3);
        min-height: 48px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        cursor: pointer;
      }
      .replan__meal--done {
        opacity: 0.62;
        cursor: not-allowed;
      }
      .replan__meal-main,
      .replan__meal-meta {
        display: flex;
        gap: var(--space-2);
        min-width: 0;
      }
      .replan__meal-main {
        flex-wrap: wrap;
      }
      .replan__meal-main span {
        overflow-wrap: anywhere;
      }
      .replan__meal-meta {
        justify-content: flex-end;
        flex-wrap: wrap;
        color: var(--text-secondary);
        font-size: var(--text-xs);
      }
      .replan__field {
        display: grid;
        gap: var(--space-2);
        min-width: 0;
        font-size: var(--text-sm);
      }
      .replan__calories {
        max-width: 18rem;
      }
      .replan__draft {
        display: grid;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
      }
      .replan__draft-heading {
        flex-wrap: wrap;
        justify-content: flex-start;
      }
      .replan__draft-heading span {
        color: var(--text-secondary);
      }
      .replan__error {
        margin: 0;
        color: var(--error);
      }
      .replan__actions {
        padding-top: var(--space-2);
      }
      @media (max-width: 40rem) {
        .replan__heading {
          align-items: flex-start;
          flex-direction: column;
        }
        .replan__bulk-actions {
          width: 100%;
          justify-content: flex-start;
        }
        .replan__meal {
          grid-template-columns: 20px minmax(0, 1fr);
        }
        .replan__meal-meta {
          grid-column: 2;
          justify-content: flex-start;
        }
        .replan__actions {
          flex-wrap: wrap;
        }
        .replan__actions > button {
          flex: 1 1 auto;
        }
      }
    `
  ]
})
export class CalendarReplanComponent implements OnInit, OnDestroy {
  @Input({ required: true }) weekStart!: string;
  @Input({ required: true }) weekEnd!: string;
  @Output() closed = new EventEmitter<void>();
  @Output() applied = new EventEmitter<void>();

  readonly householdService = inject(HouseholdService);
  private readonly calendar = inject(CalendarService);
  private readonly ai = inject(AiService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  readonly goalOptions = GOAL_OPTIONS;

  readonly meals = signal<CalendarMeal[]>([]);
  readonly days = computed<ReplanDay[]>(() => {
    const groups = new Map<string, CalendarMeal[]>();
    const order: Record<MealType, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };
    for (const meal of this.meals()) {
      const group = groups.get(meal.date) ?? [];
      group.push(meal);
      groups.set(meal.date, group);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, dayMeals]) => ({
        date,
        meals: [...dayMeals].sort(
          (left, right) =>
            order[left.mealType] - order[right.mealType] || left.id.localeCompare(right.id)
        )
      }));
  });
  readonly selectedIds = signal<string[]>([]);
  readonly selectedMeals = computed(() => {
    const selected = new Set(this.selectedIds());
    return this.meals().filter((meal) => selected.has(meal.id));
  });
  readonly drafts = signal<ReplanDraft[]>([]);
  readonly goalTypes = signal<TasteGoal[]>(['balanced']);
  readonly selectedMemberIds = signal<string[]>([]);
  readonly guests = signal<AIGuestPreferences[]>([]);
  readonly isLoadingMeals = signal(true);
  readonly loadFailed = signal(false);
  readonly isGenerating = signal(false);
  readonly isApplying = signal(false);
  readonly failed = signal(false);
  readonly contextChanged = signal(false);
  customInstructions = '';
  caloriesTarget: number | null = null;
  private householdIdAtOpen: string | null = null;
  private lastContextRevision = this.householdService.contextRevision();
  private lastActiveHouseholdId = this.householdService.activeHouseholdId();
  private loadSubscription?: Subscription;
  private generationSubscription?: Subscription;
  private applicationSubscription?: Subscription;
  private readonly householdContextEffect = effect(() => {
    const revision = this.householdService.contextRevision();
    const activeHouseholdId = this.householdService.activeHouseholdId();
    if (
      revision === this.lastContextRevision &&
      activeHouseholdId === this.lastActiveHouseholdId
    ) {
      return;
    }
    this.lastContextRevision = revision;
    this.lastActiveHouseholdId = activeHouseholdId;
    this.invalidateHouseholdContext();
  });

  ngOnInit(): void {
    this.householdService.ensureHousehold();
    this.householdIdAtOpen = this.householdService.activeHouseholdId();
    this.selectedMemberIds.set(
      this.householdService
        .household()
        ?.members.filter((member) => member.isActive)
        .map((member) => member.id) ?? []
    );
    const currentGoals = this.calendar.goals();
    const currentTypes =
      currentGoals?.types ?? (currentGoals?.type ? [currentGoals.type] : ['balanced']);
    this.goalTypes.set([...currentTypes] as TasteGoal[]);
    this.customInstructions = currentGoals?.customInstructions ?? '';
    this.caloriesTarget = currentGoals?.dailyCalories ?? null;
    this.loadSubscription = this.calendar.getMealsForRange(this.weekStart, this.weekEnd).subscribe({
      next: (meals) => {
        this.meals.set(meals);
        this.isLoadingMeals.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.isLoadingMeals.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.generationSubscription?.unsubscribe();
    this.applicationSubscription?.unsubscribe();
  }

  trackDay(_index: number, day: ReplanDay): string {
    return day.date;
  }
  trackMeal(_index: number, meal: CalendarMeal): string {
    return meal.id;
  }
  trackDraft(_index: number, draft: ReplanDraft): string {
    return draft.id;
  }

  formatDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(dateLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(new Date(year, month - 1, day));
  }

  weekLabel(): string {
    const format = new Intl.DateTimeFormat(dateLocale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const toDate = (iso: string) => {
      const [year, month, day] = iso.split('-').map(Number);
      return new Date(year, month - 1, day);
    };
    return `${format.format(toDate(this.weekStart))} – ${format.format(toDate(this.weekEnd))}`;
  }

  mealLabel(type: MealType): string {
    return this.i18n.t(MEAL_LABEL_KEYS[type]);
  }

  eligibleMeals(day: ReplanDay): CalendarMeal[] {
    return day.meals.filter((meal) => !meal.completed);
  }
  isDaySelected(day: ReplanDay): boolean {
    const selected = new Set(this.selectedIds());
    const eligible = this.eligibleMeals(day);
    return eligible.length > 0 && eligible.every((meal) => selected.has(meal.id));
  }

  selectAll(): void {
    this.selectedIds.set(
      this.meals()
        .filter((meal) => !meal.completed)
        .map((meal) => meal.id)
    );
    this.resetCandidatePreview();
  }

  deselectAll(): void {
    this.selectedIds.set([]);
    this.resetCandidatePreview();
  }

  toggleDay(day: ReplanDay, checked: boolean): void {
    const ids = new Set(this.selectedIds());
    for (const meal of this.eligibleMeals(day)) checked ? ids.add(meal.id) : ids.delete(meal.id);
    this.selectedIds.set([...ids]);
    this.resetCandidatePreview();
  }

  toggleMeal(id: string, checked: boolean): void {
    const meal = this.meals().find((item) => item.id === id);
    if (!meal || meal.completed) return;
    const ids = new Set(this.selectedIds());
    checked ? ids.add(id) : ids.delete(id);
    this.selectedIds.set([...ids]);
    this.resetCandidatePreview();
  }

  updateMembers(ids: string[]): void {
    this.selectedMemberIds.set([...ids]);
    this.resetCandidatePreview();
  }
  updateGuests(guests: AIGuestPreferences[]): void {
    this.guests.set(guests);
    this.resetCandidatePreview();
  }

  toggleGoal(goal: TasteGoal): void {
    this.goalTypes.set(toggleTasteGoal(this.goalTypes(), goal));
    this.resetCandidatePreview();
  }

  resetCandidatePreview(): void {
    if (this.isGenerating()) {
      this.generationSubscription?.unsubscribe();
      this.isGenerating.set(false);
    }
    if (this.drafts().length) this.drafts.set([]);
    this.failed.set(false);
  }

  goalsReady(): boolean {
    return (
      this.goalTypes().length > 0 &&
      (!this.goalTypes().includes('custom') || Boolean(this.customInstructions.trim()))
    );
  }

  canGenerate(): boolean {
    return (
      !this.isLoadingMeals() &&
      !this.loadFailed() &&
      !this.isGenerating() &&
      !this.isApplying() &&
      this.selectedMeals().length > 0 &&
      this.selectedMeals().length <= 28 &&
      this.goalsReady() &&
      !this.contextChanged()
    );
  }

  canApply(): boolean {
    return (
      !this.isApplying() &&
      !this.isGenerating() &&
      !this.contextChanged() &&
      this.drafts().length === this.selectedMeals().length &&
      this.drafts().length > 0 &&
      this.drafts().every((draft) => draft.name.trim().length > 0)
    );
  }

  requestAlternatives(): void {
    if (!this.canGenerate()) return;
    if (!this.contextIsCurrent()) return;
    this.failed.set(false);
    this.drafts.set([]);
    this.isGenerating.set(true);
    const selected = this.selectedMeals();
    const goals = {
      types: [...this.goalTypes()],
      ...(Number(this.caloriesTarget) > 0 ? { caloriesTarget: Number(this.caloriesTarget) } : {}),
      ...(this.goalTypes().includes('custom') && this.customInstructions.trim()
        ? { customInstructions: this.customInstructions.trim() }
        : {})
    };
    const guests = this.guests().map((guest) => ({
      allergies: [...guest.allergies],
      intolerances: [...guest.intolerances],
      diets: [...guest.diets],
      likes: [...guest.likes],
      dislikes: [...guest.dislikes],
      notes: guest.notes
    }));
    this.generationSubscription?.unsubscribe();
    this.generationSubscription = forkJoin(
      selected.map((meal) =>
        this.ai.replaceMeal({
          mealId: meal.id,
          householdMemberIds: [...this.selectedMemberIds()],
          guests,
          goals
        })
      )
    ).subscribe({
      next: (candidates) => {
        this.isGenerating.set(false);
        if (
          !this.contextIsCurrent() ||
          candidates.length !== selected.length ||
          candidates.some((candidate) => !candidate)
        ) {
          this.failed.set(true);
          return;
        }
        this.drafts.set(selected.map((meal, index) => this.toDraft(meal, candidates[index]!)));
      },
      error: () => {
        this.isGenerating.set(false);
        this.failed.set(true);
      }
    });
  }

  applyAlternatives(): void {
    if (!this.canApply()) return;
    if (!this.contextIsCurrent()) return;
    const replacements = this.drafts().map((draft) => ({
      id: draft.id,
      customMeal: draft.name.trim()
    }));
    this.isApplying.set(true);
    this.failed.set(false);
    this.applicationSubscription?.unsubscribe();
    this.applicationSubscription = this.calendar.replaceSelectedMeals(replacements).subscribe({
      next: (applied) => {
        this.isApplying.set(false);
        this.applicationSubscription = undefined;
        if (!this.contextIsCurrent()) return;
        if (!applied) {
          this.failed.set(true);
          return;
        }
        this.toast.success(
          this.i18n.t('calendar.replan_applied_title'),
          this.i18n.t('calendar.replan_applied_body', { count: replacements.length })
        );
        this.applied.emit();
        this.closed.emit();
      },
      error: () => {
        this.isApplying.set(false);
        this.applicationSubscription = undefined;
        if (!this.contextIsCurrent()) return;
        this.failed.set(true);
      }
    });
  }

  close(): void {
    if (this.isApplying()) return;
    this.generationSubscription?.unsubscribe();
    this.isGenerating.set(false);
    this.closed.emit();
  }

  private contextIsCurrent(): boolean {
    if (
      !this.contextChanged() &&
      this.householdService.activeHouseholdId() === this.householdIdAtOpen
    ) {
      return true;
    }
    this.invalidateHouseholdContext();
    return false;
  }

  private invalidateHouseholdContext(): void {
    this.contextChanged.set(true);
    this.failed.set(false);
    this.loadSubscription?.unsubscribe();
    this.generationSubscription?.unsubscribe();
    this.applicationSubscription?.unsubscribe();
    this.isLoadingMeals.set(false);
    this.isGenerating.set(false);
    this.isApplying.set(false);
    this.meals.set([]);
    this.selectedIds.set([]);
    this.selectedMemberIds.set([]);
    this.guests.set([]);
    this.drafts.set([]);
    this.applicationSubscription = undefined;
  }

  private toDraft(meal: CalendarMeal, candidate: AIReplacementCandidate): ReplanDraft {
    return {
      id: meal.id,
      date: meal.date,
      mealType: meal.mealType,
      originalTitle: meal.title,
      name: candidate.name,
      description: candidate.description,
      ingredients: [...candidate.ingredients],
      estimatedTime: candidate.estimatedTime,
      servings: candidate.servings
    };
  }
}
