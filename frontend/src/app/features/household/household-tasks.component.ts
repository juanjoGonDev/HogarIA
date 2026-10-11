import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { HouseholdPlanService } from '../../core/services/household-plan.service';
import { HouseholdTasksService } from '../../core/services/household-tasks.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import type { HouseholdMember } from '../../shared/models/household.model';
import type { HouseholdPlanSpace } from '../../shared/models/household-plan.model';
import type {
  HouseholdTaskOccurrence,
  VersionedHouseholdTaskWeek
} from '../../shared/models/household-task.model';
import { assignHouseholdTasksFairly } from './household-task-assignment';
import { getHouseholdAreaLabel } from './household-area-catalog';

interface WeekDay {
  date: string;
  label: string;
}

@Component({
  selector: 'app-household-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, PickerComponent],
  templateUrl: './household-tasks.component.html',
  styleUrl: './household-tasks.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdTasksComponent implements OnChanges {
  @Input({ required: true }) householdId = '';
  @Input() canEdit = false;
  @Input() members: HouseholdMember[] = [];
  @Input() selectedSpaceId: string | null = null;
  @Input() refreshToken = 0;

  private readonly tasksService = inject(HouseholdTasksService);
  private readonly planService = inject(HouseholdPlanService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private requestGeneration = 0;
  private planGeneration = 0;

  readonly weekStart = signal(getMondayIsoDate(new Date()));
  readonly snapshot = signal<VersionedHouseholdTaskWeek>({
    weekStart: this.weekStart(),
    version: 0,
    tasks: []
  });
  readonly draftTasks = signal<HouseholdTaskOccurrence[]>([]);
  readonly spaces = signal<HouseholdPlanSpace[]>([]);
  readonly filterSpaceId = signal('');
  readonly newTitle = signal('');
  readonly newDetails = signal('');
  readonly newDate = signal(this.weekStart());
  readonly newSpaceId = signal('');
  readonly newMemberId = signal('');
  readonly randomPreview = signal<HouseholdTaskOccurrence[] | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadingSpaces = signal(false);
  readonly errorKey = signal<TranslationKey | null>(null);
  readonly noticeKey = signal<TranslationKey | null>(null);

  readonly weekDays = computed(() =>
    Array.from({ length: 7 }, (_, offset) => {
      const date = addDaysIso(this.weekStart(), offset);
      const localDate = parseLocalDate(date);
      const locale = this.i18n.resolved() === 'es' ? 'es-ES' : 'en-GB';
      return {
        date,
        label: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' })
          .format(localDate)
          .replace(/^\p{L}/u, (first) => first.toLocaleUpperCase(locale))
      } satisfies WeekDay;
    })
  );
  readonly dayPickerOptions = computed<PickerOption[]>(() =>
    this.weekDays().map((day) => ({ value: day.date, label: day.label }))
  );
  readonly spacePickerOptions = computed<PickerOption[]>(() => [
    { value: '', label: this.i18n.t('household.tasks_whole_home') },
    ...this.spaces().map((space) => ({ value: space.id, label: this.areaName(space.id) }))
  ]);
  readonly filterSpacePickerOptions = computed<PickerOption[]>(() => [
    { value: '', label: this.i18n.t('household.tasks_all_areas') },
    ...this.spaces().map((space) => ({ value: space.id, label: this.areaName(space.id) }))
  ]);
  readonly visibleTasks = computed(() => {
    const spaceId = this.filterSpaceId();
    return this.draftTasks()
      .filter((task) => !spaceId || task.spaceId === spaceId)
      .slice()
      .sort(
        (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.title.localeCompare(b.title)
      );
  });
  readonly isDirty = computed(
    () => JSON.stringify(this.draftTasks()) !== JSON.stringify(this.snapshot().tasks)
  );
  readonly randomPreviewDiffers = computed(() => {
    const preview = this.randomPreview();
    return Boolean(preview && JSON.stringify(preview) !== JSON.stringify(this.draftTasks()));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedSpaceId']) {
      this.filterSpaceId.set(this.selectedSpaceId ?? '');
      if (
        this.selectedSpaceId &&
        this.spaces().some((space) => space.id === this.selectedSpaceId)
      ) {
        this.newSpaceId.set(this.selectedSpaceId);
      }
    }
    if (changes['householdId'] && this.householdId) {
      this.loadWeek();
      this.loadSpaces();
      return;
    }
    if (changes['refreshToken'] && !changes['refreshToken'].firstChange) {
      this.loadWeek();
      this.loadSpaces();
    }
  }

  loadWeek(): void {
    const generation = ++this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    const requestedWeek = this.weekStart();
    this.loading.set(true);
    this.randomPreview.set(null);
    this.errorKey.set(null);
    this.tasksService
      .load(requestedHouseholdId, requestedWeek)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId, requestedWeek)) return;
          this.snapshot.set(snapshot);
          this.draftTasks.set(structuredClone(snapshot.tasks));
          this.loading.set(false);
        },
        error: () => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId, requestedWeek)) return;
          this.loading.set(false);
          this.errorKey.set('household.tasks_load_error');
        }
      });
  }

  shiftWeek(weeks: number): void {
    this.weekStart.set(addDaysIso(this.weekStart(), weeks * 7));
    this.newDate.set(this.weekStart());
    this.randomPreview.set(null);
    this.loadWeek();
  }

  addTask(): void {
    const title = this.newTitle().trim();
    if (!this.canEdit || !title || this.draftTasks().length >= 200) return;
    const task: HouseholdTaskOccurrence = {
      id: this.newId(),
      title,
      details: this.newDetails().trim() || null,
      spaceId: this.newSpaceId() || null,
      scheduledDate: this.newDate(),
      assignedMemberId: this.newMemberId() || null,
      completed: false
    };
    this.draftTasks.update((tasks) => [...tasks, task]);
    this.newTitle.set('');
    this.newDetails.set('');
    this.randomPreview.set(null);
    this.errorKey.set(null);
  }

  updateTask(taskId: string, update: Partial<HouseholdTaskOccurrence>): void {
    if (!this.canEdit) return;
    this.draftTasks.update((tasks) =>
      tasks.map((task) => (task.id === taskId ? { ...task, ...update } : task))
    );
    this.randomPreview.set(null);
    this.errorKey.set(null);
  }

  deleteTask(taskId: string): void {
    if (!this.canEdit) return;
    this.draftTasks.update((tasks) => tasks.filter((task) => task.id !== taskId));
    this.randomPreview.set(null);
  }

  createRandomPreview(): void {
    if (!this.canEdit || !this.draftTasks().length) return;
    const activeMemberIds = this.members
      .filter((member) => member.isActive)
      .map((member) => member.userId);
    const result = assignHouseholdTasksFairly(this.draftTasks(), activeMemberIds);
    if (!result.ok) {
      this.errorKey.set(
        result.reason === 'no-members'
          ? 'household.tasks_no_active_members'
          : 'household.tasks_distribution_impossible'
      );
      this.randomPreview.set(null);
      return;
    }
    this.errorKey.set(null);
    this.randomPreview.set(result.tasks);
  }

  applyRandomPreview(): void {
    const preview = this.randomPreview();
    if (!preview || !this.canEdit) return;
    this.draftTasks.set(structuredClone(preview));
    this.randomPreview.set(null);
    this.noticeKey.set('household.tasks_distribution_applied_locally');
  }

  discardRandomPreview(): void {
    this.randomPreview.set(null);
  }

  saveWeek(): void {
    if (!this.canEdit || !this.isDirty() || this.saving() || this.randomPreview()) return;
    const generation = this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    const requestedWeek = this.weekStart();
    const tasks = structuredClone(this.draftTasks());
    this.saving.set(true);
    this.errorKey.set(null);
    this.noticeKey.set(null);
    this.tasksService
      .save(requestedHouseholdId, requestedWeek, this.snapshot().version, tasks)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId, requestedWeek)) return;
          this.snapshot.set(snapshot);
          this.draftTasks.set(structuredClone(snapshot.tasks));
          this.saving.set(false);
          this.noticeKey.set('household.tasks_saved');
        },
        error: (error: HttpErrorResponse) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId, requestedWeek)) return;
          this.saving.set(false);
          this.errorKey.set(
            error.status === 409
              ? 'household.tasks_conflict'
              : error.error?.code === 'TASK_MEMBER_NOT_ACTIVE'
                ? 'household.tasks_member_unavailable'
                : error.error?.code === 'TASK_SPACE_NOT_FOUND'
                  ? 'household.tasks_space_unavailable'
                  : 'household.tasks_save_error'
          );
        }
      });
  }

  discardChanges(): void {
    this.draftTasks.set(structuredClone(this.snapshot().tasks));
    this.randomPreview.set(null);
    this.errorKey.set(null);
    this.noticeKey.set(null);
  }

  reload(): void {
    this.loadWeek();
    this.loadSpaces();
  }

  tasksForDay(date: string): HouseholdTaskOccurrence[] {
    return this.visibleTasks().filter((task) => task.scheduledDate === date);
  }

  memberName(memberId: string | null): string {
    if (!memberId) return this.i18n.t('household.tasks_unassigned');
    const member = this.members.find((candidate) => candidate.userId === memberId);
    if (!member) return this.i18n.t('household.tasks_member_unavailable');
    return member.isActive
      ? member.name
      : `${member.name} · ${this.i18n.t('household.tasks_inactive_member')}`;
  }

  areaName(spaceId: string | null): string {
    if (!spaceId) return this.i18n.t('household.tasks_whole_home');
    const space = this.spaces().find((candidate) => candidate.id === spaceId);
    return space
      ? space.label || getHouseholdAreaLabel(space.kind, this.i18n.resolved())
      : this.i18n.t('household.tasks_area_removed');
  }

  isInactiveMember(memberId: string | null): boolean {
    return Boolean(
      memberId && !this.members.some((member) => member.userId === memberId && member.isActive)
    );
  }

  hasSpace(spaceId: string | null): boolean {
    return Boolean(spaceId && this.spaces().some((space) => space.id === spaceId));
  }

  areaFilterOptions(): PickerOption[] {
    return this.filterSpacePickerOptions();
  }

  spaceOptions(currentSpaceId: string | null = null): PickerOption[] {
    const options = this.spacePickerOptions();
    if (currentSpaceId && !this.hasSpace(currentSpaceId)) {
      return [
        ...options,
        {
          value: currentSpaceId,
          label: this.i18n.t('household.tasks_area_removed'),
          disabled: true
        }
      ];
    }
    return options;
  }

  memberOptions(currentMemberId: string | null = null): PickerOption[] {
    const options: PickerOption[] = [
      { value: '', label: this.i18n.t('household.tasks_unassigned') },
      ...this.members.map((member) => ({
        value: member.userId,
        label: this.memberName(member.userId),
        disabled: !member.isActive
      }))
    ];
    if (currentMemberId && !this.members.some((member) => member.userId === currentMemberId)) {
      return [
        ...options,
        { value: currentMemberId, label: this.memberName(currentMemberId), disabled: true }
      ];
    }
    return options;
  }

  dayOptions(currentDate?: string): PickerOption[] {
    const options = this.dayPickerOptions();
    if (currentDate && !options.some((option) => option.value === currentDate)) {
      return [...options, { value: currentDate, label: currentDate, disabled: true }];
    }
    return options;
  }

  private loadSpaces(): void {
    const generation = ++this.planGeneration;
    const requestedHouseholdId = this.householdId;
    this.loadingSpaces.set(true);
    this.planService
      .load(requestedHouseholdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (generation !== this.planGeneration || requestedHouseholdId !== this.householdId)
            return;
          this.spaces.set(snapshot.plan?.floors.flatMap((floor) => floor.spaces) ?? []);
          if (
            this.selectedSpaceId &&
            this.spaces().some((space) => space.id === this.selectedSpaceId)
          ) {
            this.newSpaceId.set(this.selectedSpaceId);
          }
          this.loadingSpaces.set(false);
        },
        error: () => {
          if (generation !== this.planGeneration || requestedHouseholdId !== this.householdId)
            return;
          this.spaces.set([]);
          this.loadingSpaces.set(false);
        }
      });
  }

  private isCurrentRequest(generation: number, householdId: string, weekStart: string): boolean {
    return (
      generation === this.requestGeneration &&
      householdId === this.householdId &&
      weekStart === this.weekStart()
    );
  }

  private newId(): string {
    return `task-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
  }
}

export function getMondayIsoDate(date: Date): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  return formatLocalDate(local);
}

function addDaysIso(isoDate: string, days: number): string {
  const date = parseLocalDate(isoDate);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
