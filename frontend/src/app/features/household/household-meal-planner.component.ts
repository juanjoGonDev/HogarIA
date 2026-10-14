import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  computed,
  inject,
  signal
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { HouseholdMealProposalService } from '../../core/services/household-meal-proposal.service';
import type {
  HouseholdMealProposal,
  HouseholdMealProposalEvent,
  HouseholdMealProposalIngredient,
  HouseholdMealProposalRecipe,
  HouseholdMealProposalRecipeReference,
  HouseholdMealRecipeInstructionLevel,
  HouseholdMealRecipeInstructionStep
} from '../../core/services/household-meal-proposal.service';
import { HouseholdMealShoppingService } from '../../core/services/household-meal-shopping.service';
import type {
  HouseholdMealShoppingApproval,
  HouseholdMealShoppingIngredient,
  HouseholdMealShoppingPreview,
  HouseholdMealShoppingStockStatus
} from '../../core/services/household-meal-shopping.service';
import { I18nService } from '../../core/services/i18n.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CheckboxComponent } from '../../shared/components/ui/checkbox/checkbox.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { PickerComponent } from '../../shared/components/ui/picker/picker.component';
import type { PickerOption } from '../../shared/components/ui/picker/picker.component';
import type { HouseholdMember } from '../../shared/models/household.model';
import type { MealType } from '../../shared/models/calendar.model';
import { validateHouseholdMealProposal } from './household-meal-proposal.validation';

interface ProposalDay {
  date: string;
  label: string;
  events: HouseholdMealProposalEvent[];
}

interface ProposalContext {
  householdId: string;
  weekStart: string;
  memberIds: string[];
}

type HouseholdMealProposalStep = 'prepare' | 'review' | 'shopping';

interface ShoppingDraftLine extends HouseholdMealShoppingIngredient {
  key: string;
  optional: boolean;
  included: boolean;
  addQuantity: number;
}

const SHOPPING_STATUS_LABELS: Record<HouseholdMealShoppingStockStatus, TranslationKey> = {
  matched: 'household.meal_shopping_matched',
  not_found: 'household.meal_shopping_not_found',
  ambiguous: 'household.meal_shopping_ambiguous',
  unit_mismatch: 'household.meal_shopping_unit_mismatch',
  pantry_not_shared: 'household.meal_shopping_pantry_not_shared'
};

const RECIPE_INSTRUCTION_LEVELS: Array<{
  value: HouseholdMealRecipeInstructionLevel;
  label: TranslationKey;
}> = [
  { value: 'basic', label: 'household.meal_proposal_level_basic' },
  { value: 'intermediate', label: 'household.meal_proposal_level_intermediate' },
  { value: 'expert', label: 'household.meal_proposal_level_expert' }
];

@Component({
  selector: 'app-household-meal-planner',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    ButtonComponent,
    CheckboxComponent,
    IconComponent,
    PickerComponent
  ],
  templateUrl: './household-meal-planner.component.html',
  styleUrl: './household-meal-planner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdMealPlannerComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) householdId = '';
  @Input() canEdit = false;
  @Input() canViewShopping = true;
  @Input() members: HouseholdMember[] = [];

  private readonly service = inject(HouseholdMealProposalService);
  private readonly shoppingService = inject(HouseholdMealShoppingService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private generation = 0;
  private request?: Subscription;
  private shoppingGeneration = 0;
  private shoppingRequest?: Subscription;

  readonly membersState = signal<HouseholdMember[]>([]);
  readonly eligibleMembers = computed(() =>
    this.membersState().filter(
      (member) => member.isActive && member.permissions?.calendar?.view === true
    )
  );
  readonly selectedMemberIds = signal<string[]>([]);
  readonly weekStart = signal(mondayIsoDate(new Date()));
  readonly proposal = signal<HouseholdMealProposal | null>(null);
  readonly recipeLevelByEvent = signal<Record<string, HouseholdMealRecipeInstructionLevel>>({});
  readonly proposalContext = signal<ProposalContext | null>(null);
  readonly generating = signal(false);
  readonly confirming = signal(false);
  readonly confirmed = signal(false);
  readonly errorKey = signal<TranslationKey | null>(null);
  readonly successKey = signal<TranslationKey | null>(null);
  readonly savedEventsCount = signal(0);
  readonly unresolvedEventsCount = signal(0);
  readonly activeMealStep = signal<HouseholdMealProposalStep>('prepare');
  readonly selectedProposalDate = signal('');
  readonly shoppingPreview = signal<HouseholdMealShoppingPreview | null>(null);
  readonly shoppingLines = signal<ShoppingDraftLine[]>([]);
  readonly shoppingLoading = signal(false);
  readonly shoppingSaving = signal(false);
  readonly shoppingErrorKey = signal<TranslationKey | null>(null);
  readonly shoppingApproval = signal<HouseholdMealShoppingApproval | null>(null);
  readonly shoppingReturnStep = signal<'prepare' | 'review'>('review');
  readonly requiredShoppingLines = computed(() =>
    this.shoppingLines().filter((line) => !line.optional)
  );
  readonly optionalShoppingLines = computed(() =>
    this.shoppingLines().filter((line) => line.optional)
  );
  readonly canApproveShopping = computed(() => {
    const selected = this.shoppingLines().filter((line) => line.included);
    return (
      this.canViewShopping &&
      Boolean(this.shoppingPreview()) &&
      selected.length > 0 &&
      selected.every(
        (line) =>
          Number.isFinite(line.addQuantity) && line.addQuantity > 0 && line.addQuantity <= 10_000
      ) &&
      !this.shoppingLoading() &&
      !this.shoppingSaving() &&
      !this.shoppingApproval()
    );
  });
  readonly hasConfirmableMeals = computed(
    () => this.proposal()?.events.some((event) => event.status === 'scheduled') ?? false
  );
  readonly proposalRecipesByAlias = computed(
    () => new Map((this.proposal()?.recipes ?? []).map((reference) => [reference.alias, reference]))
  );

  readonly proposalIsCurrent = computed(() => {
    const proposal = this.proposal();
    const context = this.proposalContext();
    if (!proposal || !context) return false;
    return (
      context.householdId === this.householdId &&
      context.weekStart === this.weekStart() &&
      proposal.weekStart === this.weekStart() &&
      sameIds(context.memberIds, this.selectedMemberIds())
    );
  });
  readonly canGenerate = computed(
    () =>
      this.canEdit &&
      Boolean(this.householdId) &&
      this.selectedMemberIds().length > 0 &&
      !this.generating() &&
      !this.confirming()
  );
  readonly canConfirm = computed(
    () =>
      this.canEdit &&
      this.proposalIsCurrent() &&
      this.hasConfirmableMeals() &&
      !this.confirmed() &&
      !this.generating() &&
      !this.confirming()
  );
  readonly trackMember = (_index: number, member: HouseholdMember) => member.id;
  readonly trackDay = (_index: number, day: ProposalDay) => day.date;
  readonly trackEvent = (_index: number, event: HouseholdMealProposalEvent) => event.id;
  readonly trackIngredient = (_index: number, ingredient: HouseholdMealProposalIngredient) =>
    `${ingredient.name}-${_index}`;
  readonly trackIndex = (index: number) => index;
  readonly recipeInstructionLevels = RECIPE_INSTRUCTION_LEVELS;
  readonly proposalDays = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const days: ProposalDay[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(proposal.weekStart, offset);
      const events = proposal.events
        .filter((event) => event.date === date)
        .sort((left, right) => mealOrder(left.mealType) - mealOrder(right.mealType));
      if (events.length) days.push({ date, label: this.formatDate(date), events });
    }
    return days;
  });
  readonly proposalDayOptions = computed<PickerOption[]>(() =>
    this.proposalDays().map((day) => ({ value: day.date, label: day.label }))
  );
  readonly selectedProposalDay = computed(() => {
    const days = this.proposalDays();
    return days.find((day) => day.date === this.selectedProposalDate()) ?? days[0] ?? null;
  });

  ngOnChanges(changes: SimpleChanges): void {
    const householdChanged =
      changes['householdId'] &&
      !changes['householdId'].firstChange &&
      changes['householdId'].previousValue !== changes['householdId'].currentValue;
    if (householdChanged) this.resetForHouseholdChange();

    if (changes['members']) {
      this.membersState.set(this.members ?? []);
      const eligibleIds = new Set(this.eligibleMembers().map((member) => member.id));
      const nextSelection =
        householdChanged || changes['members'].firstChange
          ? [...eligibleIds]
          : this.selectedMemberIds().filter((id) => eligibleIds.has(id));
      if (!sameIds(nextSelection, this.selectedMemberIds())) {
        this.selectedMemberIds.set(nextSelection);
        if (!householdChanged) this.invalidateProposalState();
      }
    }
  }

  ngOnDestroy(): void {
    this.generation += 1;
    this.request?.unsubscribe();
    this.shoppingGeneration += 1;
    this.shoppingRequest?.unsubscribe();
  }

  toggleMember(memberId: string, checked: boolean): void {
    if (this.generating() || this.confirming()) return;
    if (!this.eligibleMembers().some((member) => member.id === memberId)) return;
    const next = new Set(this.selectedMemberIds());
    if (checked) next.add(memberId);
    else next.delete(memberId);
    this.selectedMemberIds.set([...next]);
    this.invalidateProposalState();
  }

  setWeekFromInput(value: string): void {
    if (!value || this.generating() || this.confirming()) return;
    // Date inputs are local calendar dates. Noon avoids a timezone offset moving the
    // selected date to the previous day before it is normalized to Monday.
    this.weekStart.set(mondayIsoDate(new Date(`${value}T12:00:00`)));
    this.invalidateProposalState();
  }

  shiftWeek(direction: -1 | 1): void {
    if (this.generating() || this.confirming()) return;
    this.weekStart.set(addDays(this.weekStart(), direction * 7));
    this.invalidateProposalState();
  }

  generateProposal(): void {
    if (!this.canGenerate()) return;
    const context: ProposalContext = {
      householdId: this.householdId,
      weekStart: this.weekStart(),
      memberIds: [...this.selectedMemberIds()]
    };
    const requestId = ++this.generation;
    this.request?.unsubscribe();
    this.proposal.set(null);
    this.recipeLevelByEvent.set({});
    this.proposalContext.set(null);
    this.confirmed.set(false);
    this.errorKey.set(null);
    this.successKey.set(null);
    this.generating.set(true);
    this.request = this.service
      .createProposal(context.householdId, {
        weekStart: context.weekStart,
        householdMemberIds: context.memberIds
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (requestId === this.generation) this.generating.set(false);
        })
      )
      .subscribe({
        next: (response) => {
          if (requestId !== this.generation || !this.isContextCurrent(context)) return;
          if (
            !validateHouseholdMealProposal(
              response,
              context.weekStart,
              context.memberIds,
              this.membersState()
            )
          ) {
            this.errorKey.set('household.meal_proposal_invalid_response');
            return;
          }
          this.proposal.set(response);
          this.proposalContext.set(context);
          this.selectedProposalDate.set(this.proposalDays()[0]?.date ?? '');
          this.activeMealStep.set('review');
          if (!response.events.length) this.errorKey.set('household.meal_proposal_empty');
        },
        error: (error: unknown) => {
          if (requestId !== this.generation || !this.isContextCurrent(context)) return;
          this.errorKey.set(this.errorTranslation(error, 'generate'));
        }
      });
  }

  confirmProposal(): void {
    const proposal = this.proposal();
    const context = this.proposalContext();
    if (!proposal || !context || !this.canConfirm()) return;
    const requestId = ++this.generation;
    this.request?.unsubscribe();
    this.errorKey.set(null);
    this.successKey.set(null);
    this.confirming.set(true);
    this.request = this.service
      .confirmProposal(context.householdId, {
        proposalId: proposal.proposalId,
        weekStart: context.weekStart,
        householdMemberIds: [...context.memberIds],
        recipes: proposal.recipes,
        events: proposal.events
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (requestId === this.generation) this.confirming.set(false);
        })
      )
      .subscribe({
        next: (result) => {
          if (requestId !== this.generation || !this.isContextCurrent(context)) return;
          this.confirmed.set(true);
          this.savedEventsCount.set(result.events.length);
          this.unresolvedEventsCount.set(result.unresolvedEvents.length);
          this.successKey.set(
            result.unresolvedEvents.length
              ? 'household.meal_proposal_saved_with_unresolved'
              : 'household.meal_proposal_saved'
          );
        },
        error: (error: unknown) => {
          if (requestId !== this.generation || !this.isContextCurrent(context)) return;
          this.errorKey.set(this.errorTranslation(error, 'confirm'));
        }
      });
  }

  isSelected(memberId: string): boolean {
    return this.selectedMemberIds().includes(memberId);
  }

  selectMealStep(step: HouseholdMealProposalStep): void {
    if (step === 'shopping') {
      this.openShoppingReview();
      return;
    }
    this.activeMealStep.set(step);
  }

  onMealStepKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const steps: HouseholdMealProposalStep[] = ['prepare', 'review', 'shopping'];
    const currentIndex = steps.indexOf(this.activeMealStep());
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? steps.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + steps.length) % steps.length;
    const next = steps[nextIndex];
    const list = (event.currentTarget as HTMLElement | null)?.parentElement;
    const tab = list?.querySelector<HTMLButtonElement>(
      `[data-test="meal-proposal-step-tab-${next}"]`
    );
    tab?.focus({ preventScroll: true });
    if (next === 'shopping') this.openShoppingReview();
    else this.selectMealStep(next);
  }

  openShoppingReview(): void {
    if (!this.canViewShopping || !this.householdId || this.shoppingLoading()) return;
    this.shoppingReturnStep.set(this.activeMealStep() === 'prepare' ? 'prepare' : 'review');
    const householdId = this.householdId;
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = addDays(startDate, 30);
    const requestId = ++this.shoppingGeneration;
    this.shoppingRequest?.unsubscribe();
    this.shoppingPreview.set(null);
    this.shoppingLines.set([]);
    this.shoppingApproval.set(null);
    this.shoppingErrorKey.set(null);
    this.shoppingLoading.set(true);
    this.activeMealStep.set('shopping');
    this.shoppingRequest = this.shoppingService
      .loadPreview(householdId, startDate, endDate)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (requestId === this.shoppingGeneration) this.shoppingLoading.set(false);
        })
      )
      .subscribe({
        next: (preview) => {
          if (requestId !== this.shoppingGeneration || householdId !== this.householdId) return;
          if (!isShoppingPreviewForRange(preview, startDate, endDate)) {
            this.shoppingErrorKey.set('household.meal_shopping_invalid_preview');
            return;
          }
          this.shoppingPreview.set(preview);
          this.shoppingLines.set([
            ...preview.requiredIngredients.map((ingredient) =>
              makeShoppingDraftLine(ingredient, false)
            ),
            ...preview.optionalIngredients.map((ingredient) =>
              makeShoppingDraftLine(ingredient, true)
            )
          ]);
        },
        error: (error: unknown) => {
          if (requestId !== this.shoppingGeneration || householdId !== this.householdId) return;
          this.shoppingErrorKey.set(this.shoppingErrorTranslation(error));
        }
      });
  }

  setShoppingIncluded(key: string, included: boolean): void {
    if (this.shoppingSaving() || this.shoppingApproval()) return;
    this.shoppingLines.update((lines) =>
      lines.map((line) => (line.key === key ? { ...line, included } : line))
    );
  }

  setShoppingQuantity(keyOrName: string, quantity: number): void {
    if (this.shoppingSaving() || this.shoppingApproval()) return;
    const normalized = normalizeShoppingName(keyOrName);
    this.shoppingLines.update((lines) =>
      lines.map((line) =>
        line.key === keyOrName || normalizeShoppingName(line.name) === normalized
          ? { ...line, addQuantity: quantity }
          : line
      )
    );
  }

  approveShopping(): void {
    const preview = this.shoppingPreview();
    if (!preview || !this.canApproveShopping()) return;
    const householdId = this.householdId;
    const requestId = ++this.shoppingGeneration;
    this.shoppingRequest?.unsubscribe();
    this.shoppingErrorKey.set(null);
    this.shoppingSaving.set(true);
    this.shoppingRequest = this.shoppingService
      .approve(householdId, {
        startDate: preview.startDate,
        endDate: preview.endDate,
        previewId: preview.previewId,
        items: this.shoppingLines()
          .filter((line) => line.included)
          .map((line) => ({ name: line.name, unit: line.unit, quantity: line.addQuantity }))
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (requestId === this.shoppingGeneration) this.shoppingSaving.set(false);
        })
      )
      .subscribe({
        next: (approval) => {
          if (requestId !== this.shoppingGeneration || householdId !== this.householdId) return;
          this.shoppingApproval.set(approval);
        },
        error: (error: unknown) => {
          if (requestId !== this.shoppingGeneration || householdId !== this.householdId) return;
          this.shoppingErrorKey.set(this.shoppingErrorTranslation(error));
        }
      });
  }

  cancelShoppingReview(): void {
    this.shoppingGeneration += 1;
    this.shoppingRequest?.unsubscribe();
    this.shoppingRequest = undefined;
    this.shoppingLoading.set(false);
    this.shoppingSaving.set(false);
    this.shoppingPreview.set(null);
    this.shoppingLines.set([]);
    this.shoppingApproval.set(null);
    this.shoppingErrorKey.set(null);
    this.activeMealStep.set(this.shoppingReturnStep());
  }

  shoppingStatusLabel(status: HouseholdMealShoppingStockStatus): TranslationKey {
    return SHOPPING_STATUS_LABELS[status];
  }

  trackShoppingLine(_index: number, line: ShoppingDraftLine): string {
    return line.key;
  }

  selectProposalDate(value: string): void {
    if (this.proposalDays().some((day) => day.date === value)) {
      this.selectedProposalDate.set(value);
    }
  }

  memberName(userId: string): string {
    return this.membersState().find((member) => member.userId === userId)?.name ?? '';
  }

  mealTypeLabel(mealType: MealType): TranslationKey {
    return `meal.${mealType}` as TranslationKey;
  }

  eventAssignmentLabel(event: HouseholdMealProposalEvent): TranslationKey {
    return event.participantIds.length > 1
      ? 'household.meal_proposal_shared'
      : 'household.meal_proposal_individual';
  }

  updateEventServings(event: HouseholdMealProposalEvent, input: HTMLInputElement): void {
    const nextServings = input.valueAsNumber;
    if (
      !this.canEdit ||
      this.confirming() ||
      this.confirmed() ||
      event.status !== 'scheduled' ||
      !this.recipeForEvent(event) ||
      !Number.isInteger(nextServings) ||
      nextServings < 1 ||
      nextServings > 100
    ) {
      input.value = String(event.servings);
      return;
    }

    this.proposal.update((current) => {
      if (!current) return current;
      let found = false;
      const events = current.events.map((item) => {
        if (item.id !== event.id || item.status !== 'scheduled' || !item.recipeAlias) return item;
        found = true;
        return { ...item, servings: nextServings };
      });
      return found ? { ...current, events } : current;
    });
  }

  scaledIngredientQuantity(
    ingredient: HouseholdMealProposalIngredient,
    event: HouseholdMealProposalEvent
  ): number {
    const baseServings = this.recipeForEvent(event)?.baseServings;
    if (!baseServings || event.status !== 'scheduled' || event.servings < 1) {
      return ingredient.quantity;
    }
    const scaled = (ingredient.quantity * event.servings) / baseServings;
    return Number.isFinite(scaled) ? scaled : ingredient.quantity;
  }

  recipeReferenceForEvent(
    event: HouseholdMealProposalEvent
  ): HouseholdMealProposalRecipeReference | null {
    return event.recipeAlias
      ? (this.proposalRecipesByAlias().get(event.recipeAlias) ?? null)
      : null;
  }

  recipeForEvent(event: HouseholdMealProposalEvent): HouseholdMealProposalRecipe | null {
    return this.recipeReferenceForEvent(event)?.recipe ?? null;
  }

  hasRecipeGuidance(guidance: HouseholdMealProposalRecipe['guidance']): boolean {
    return (
      guidance.appliances.length > 0 ||
      guidance.parallelTasks.length > 0 ||
      guidance.tipsAndVariations.length > 0 ||
      Boolean(guidance.batchCookingWarning?.trim())
    );
  }

  recipeOriginLabel(event: HouseholdMealProposalEvent): TranslationKey {
    return this.recipeReferenceForEvent(event)?.source === 'catalog'
      ? 'household.meal_proposal_recipe_saved'
      : 'household.meal_proposal_recipe_new';
  }

  recipeDifficultyLabel(difficulty: HouseholdMealProposalRecipe['difficulty']): TranslationKey {
    const labels: Record<HouseholdMealProposalRecipe['difficulty'], TranslationKey> = {
      easy: 'household.meal_proposal_difficulty_easy',
      medium: 'household.meal_proposal_difficulty_medium',
      hard: 'household.meal_proposal_difficulty_hard'
    };
    return labels[difficulty];
  }

  selectedRecipeLevel(eventId: string): HouseholdMealRecipeInstructionLevel {
    return this.recipeLevelByEvent()[eventId] ?? 'basic';
  }

  selectRecipeLevel(eventId: string, level: HouseholdMealRecipeInstructionLevel): void {
    this.recipeLevelByEvent.update((current) => ({ ...current, [eventId]: level }));
  }

  recipeInstructionSteps(
    event: HouseholdMealProposalEvent,
    recipe: HouseholdMealProposalRecipe
  ): HouseholdMealRecipeInstructionStep[] {
    if (recipe.instructionsByLevel) {
      return recipe.instructionsByLevel[this.selectedRecipeLevel(event.id)];
    }
    return recipe.steps ?? [];
  }

  recipeStepTimerMinutes(step: HouseholdMealRecipeInstructionStep): number | null {
    if (!step.timerRequired) return null;
    if (step.timerDuration !== undefined) return step.timerDuration;
    return step.duration ?? null;
  }

  onRecipeLevelKeydown(event: KeyboardEvent, eventId: string): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentTab = event.currentTarget as HTMLButtonElement | null;
    const tabList = currentTab?.parentElement;
    if (!currentTab || !tabList) return;
    const tabs = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(currentTab);
    if (currentIndex < 0 || tabs.length === 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    const level = nextTab.dataset['level'] as HouseholdMealRecipeInstructionLevel | undefined;
    if (!level) return;
    this.selectRecipeLevel(eventId, level);
    nextTab.focus();
  }

  recipeLevelTabId(eventId: string, level: HouseholdMealRecipeInstructionLevel): string {
    return `meal-recipe-${encodeURIComponent(eventId)}-${level}-tab`;
  }

  recipeLevelPanelId(eventId: string): string {
    return `meal-recipe-${encodeURIComponent(eventId)}-instructions`;
  }

  recipeTimeBreakdown(
    recipe: HouseholdMealProposalRecipe
  ): Array<{ label: TranslationKey; minutes: number | null }> {
    return [
      { label: 'household.meal_proposal_prep_time', minutes: recipe.prepTime },
      { label: 'household.meal_proposal_cook_time', minutes: recipe.cookTime },
      { label: 'household.meal_proposal_rest_time', minutes: recipe.restTime }
    ];
  }

  isShared(event: HouseholdMealProposalEvent): boolean {
    return event.participantIds.length > 1;
  }

  formatDate(value: string): string {
    const locale = this.i18n.resolved() === 'en' ? 'en-GB' : 'es-ES';
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC'
    }).format(parseIsoDate(value));
  }

  formatWeekRange(): string {
    const start = this.formatDate(this.weekStart());
    const end = this.formatDate(addDays(this.weekStart(), 6));
    return `${start} – ${end}`;
  }

  private isContextCurrent(context: ProposalContext): boolean {
    return (
      context.householdId === this.householdId &&
      context.weekStart === this.weekStart() &&
      sameIds(context.memberIds, this.selectedMemberIds())
    );
  }

  private resetForHouseholdChange(): void {
    this.generation += 1;
    this.request?.unsubscribe();
    this.request = undefined;
    this.shoppingGeneration += 1;
    this.shoppingRequest?.unsubscribe();
    this.shoppingRequest = undefined;
    this.proposal.set(null);
    this.proposalContext.set(null);
    this.recipeLevelByEvent.set({});
    this.confirmed.set(false);
    this.generating.set(false);
    this.confirming.set(false);
    this.selectedMemberIds.set([]);
    this.activeMealStep.set('prepare');
    this.selectedProposalDate.set('');
    this.shoppingPreview.set(null);
    this.shoppingLines.set([]);
    this.shoppingApproval.set(null);
    this.shoppingErrorKey.set(null);
    this.shoppingLoading.set(false);
    this.shoppingSaving.set(false);
    this.errorKey.set('household.meal_proposal_context_changed');
    this.successKey.set(null);
  }

  private invalidateProposalState(): void {
    this.proposalContext.set(null);
    this.confirmed.set(false);
    this.activeMealStep.set('prepare');
    this.errorKey.set(null);
    this.successKey.set(null);
  }

  private errorTranslation(error: unknown, operation: 'generate' | 'confirm'): TranslationKey {
    const code = error instanceof HttpErrorResponse ? error.error?.code : undefined;
    switch (code) {
      case 'HOUSEHOLD_CONTEXT_CHANGED':
        return 'household.meal_proposal_context_changed';
      case 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED':
        return 'household.meal_proposal_edit_permission';
      case 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED':
        return 'household.meal_proposal_view_permission';
      case 'AI_PROVIDER_NOT_CONFIGURED':
        return 'household.meal_proposal_ai_unconfigured';
      case 'AI_PROVIDER_TIMEOUT':
        return 'household.meal_proposal_ai_timeout';
      case 'AI_PROVIDER_ERROR':
      case 'MEAL_PROPOSAL_GENERATION_FAILED':
        return 'household.meal_proposal_ai_error';
      case 'MEAL_PLAN_NO_SELECTED_TURNS':
        return 'household.meal_proposal_no_turns';
      case 'MEAL_PLAN_OVERRIDE_INCOMPLETE': {
        const missingFields =
          error instanceof HttpErrorResponse && Array.isArray(error.error?.missingFields)
            ? error.error.missingFields
            : [];
        const missingObjective = missingFields.includes('objective');
        const missingSchedule = missingFields.includes('schedule');
        if (missingObjective && missingSchedule) {
          return 'household.meal_proposal_override_objective_and_schedule';
        }
        if (missingObjective) return 'household.meal_proposal_override_objective';
        if (missingSchedule) return 'household.meal_proposal_override_schedule';
        return 'household.meal_proposal_override_incomplete';
      }
      case 'MEAL_PLAN_NO_SAFE_MEALS':
        return 'household.meal_proposal_no_safe_meals';
      case 'MEAL_PROPOSAL_RECIPE_CHANGED':
        return 'household.meal_proposal_recipe_changed';
      case 'MEAL_PROPOSAL_SLOT_COVERAGE_INVALID':
      case 'MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID':
      case 'INVALID_MEAL_PROPOSAL_CONFIRMATION':
      case 'MEAL_PROPOSAL_CONFIRMATION_TOO_LARGE':
        return 'household.meal_proposal_invalid_response';
      default:
        return operation === 'confirm'
          ? 'household.meal_proposal_confirm_error'
          : 'household.meal_proposal_generate_error';
    }
  }

  private shoppingErrorTranslation(error: unknown): TranslationKey {
    const code = error instanceof HttpErrorResponse ? error.error?.code : undefined;
    switch (code) {
      case 'HOUSEHOLD_CONTEXT_CHANGED':
        return 'household.meal_proposal_context_changed';
      case 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED':
        return 'household.meal_shopping_view_permission';
      case 'MEAL_SHOPPING_PREVIEW_STALE':
        return 'household.meal_shopping_stale';
      case 'INVALID_MEAL_SHOPPING_APPROVAL':
      case 'MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW':
        return 'household.meal_shopping_invalid_preview';
      default:
        return 'household.meal_shopping_error';
    }
  }
}

function mealOrder(mealType: MealType): number {
  return { breakfast: 0, lunch: 1, snack: 2, dinner: 3 }[mealType];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function addDays(value: string, amount: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function mondayIsoDate(date: Date): string {
  const monday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function makeShoppingDraftLine(
  ingredient: HouseholdMealShoppingIngredient,
  optional: boolean
): ShoppingDraftLine {
  const defaultQuantity =
    ingredient.missingQuantity !== null && ingredient.missingQuantity > 0
      ? ingredient.missingQuantity
      : ingredient.quantity;
  return {
    ...ingredient,
    key: JSON.stringify([normalizeShoppingName(ingredient.name), ingredient.unit]),
    optional,
    included:
      !optional &&
      (ingredient.status === 'not_found' ||
        (ingredient.status === 'matched' && (ingredient.missingQuantity ?? 0) > 0)),
    addQuantity: defaultQuantity
  };
}

function normalizeShoppingName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

function isShoppingPreviewForRange(
  preview: HouseholdMealShoppingPreview,
  startDate: string,
  endDate: string
): boolean {
  return (
    preview.startDate === startDate &&
    preview.endDate === endDate &&
    /^[a-f0-9]{64}$/.test(preview.previewId) &&
    Number.isInteger(preview.plannedMealCount) &&
    preview.plannedMealCount >= 0 &&
    Array.isArray(preview.requiredIngredients) &&
    Array.isArray(preview.optionalIngredients) &&
    Array.isArray(preview.warnings)
  );
}
