import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnChanges,
  Output,
  SimpleChanges,
  ViewEncapsulation,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';
import { HouseholdPlanService } from '../../core/services/household-plan.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import { SwitchComponent } from '../../shared/components/ui/switch/switch.component';
import { HouseholdAreaGlyphComponent } from './household-area-glyph.component';
import { HouseholdPlanPreviewMapComponent } from './household-plan-preview-map.component';
import {
  HOUSEHOLD_AREA_CATALOG,
  getHouseholdAreaGroupLabel,
  getHouseholdAreaLabel
} from './household-area-catalog';
import type {
  HouseholdAreaKind,
  HouseholdDwellingType,
  HouseholdPlan,
  HouseholdPlanFloor,
  HouseholdPlanOpening,
  HouseholdPlanPoint,
  HouseholdPlanProposal,
  HouseholdPlanSpace,
  HouseholdPlanWall,
  VersionedHouseholdPlan
} from '../../shared/models/household-plan.model';
import type { HouseholdMember } from '../../shared/models/household.model';
import type { VersionedHouseholdPlanAssignments } from '../../shared/models/household-plan.model';
import {
  HOUSEHOLD_AREA_KINDS,
  HOUSEHOLD_DWELLING_TYPES
} from '../../shared/models/household-plan.model';
import {
  cloneHouseholdPlan,
  clampCoordinate,
  createHouseholdPlanPolygon,
  createHouseholdPlanFloor,
  createHouseholdPlanSpace,
  createHouseholdPlanWall,
  emptyHouseholdPlan,
  findGuidedSpacePlacement,
  moveHouseholdPlanSpace,
  openingSegment,
  openingRails as makeOpeningRails,
  doorSwing as makeDoorSwing,
  polygonCentroid
} from './household-plan-editor.utils';

type PlanTool = 'select' | 'space' | 'freeform' | 'wall' | 'door' | 'window';
type PlanPreview = 'current' | 'proposal';
type PlanEntryMethod = 'canvas' | 'photo' | 'guided';
type ProposalPresentation = 'photo' | 'chat';

const DWELLING_TYPE_KEYS: Record<HouseholdDwellingType, TranslationKey> = {
  apartment: 'household.dwelling_apartment',
  studio: 'household.dwelling_studio',
  detached_house: 'household.dwelling_detached_house',
  semi_detached_house: 'household.dwelling_semi_detached_house',
  terraced_house: 'household.dwelling_terraced_house',
  townhouse: 'household.dwelling_townhouse',
  duplex: 'household.dwelling_duplex',
  shared_home: 'household.dwelling_shared_home',
  mobile_home: 'household.dwelling_mobile_home',
  other: 'household.dwelling_other'
};
const DWELLING_CARD_LABEL_KEYS: Record<
  'apartment' | 'detached_house' | 'terraced_house' | 'other',
  TranslationKey
> = {
  apartment: 'household.plan_dwelling_short_apartment',
  detached_house: 'household.plan_dwelling_short_house',
  terraced_house: 'household.plan_dwelling_short_terraced',
  other: 'household.plan_dwelling_short_other'
};

@Component({
  selector: 'app-household-plan-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    PickerComponent,
    SwitchComponent,
    HouseholdAreaGlyphComponent,
    HouseholdPlanPreviewMapComponent
  ],
  templateUrl: './household-plan-editor.component.html',
  styleUrl: './household-plan-editor.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdPlanEditorComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) householdId = '';
  @Input() canEdit = false;
  @Input() members: HouseholdMember[] = [];
  @Output() readonly planSaved = new EventEmitter<void>();
  @Output() readonly assignmentSaved = new EventEmitter<void>();
  @Output() readonly zoneTasksSelected = new EventEmitter<string>();

  private readonly planService = inject(HouseholdPlanService);
  private readonly confirmService = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private requestGeneration = 0;
  private dragStart: {
    spaceId: string;
    point: HouseholdPlanPoint;
    space: HouseholdPlanSpace;
    moved: boolean;
  } | null = null;

  readonly areaCatalog = HOUSEHOLD_AREA_CATALOG;
  readonly dwellingTypes = HOUSEHOLD_DWELLING_TYPES;
  readonly dwellingCardTypes: Array<keyof typeof DWELLING_CARD_LABEL_KEYS> = [
    'apartment',
    'detached_house',
    'terraced_house',
    'other'
  ];
  readonly dwellingTypeOptions = computed<PickerOption[]>(() =>
    this.dwellingTypes.map((type) => ({
      value: type,
      label: this.i18n.t(DWELLING_TYPE_KEYS[type])
    }))
  );
  readonly floorOptions = computed<PickerOption[]>(() =>
    this.shownPlan().floors.map((floor) => ({ value: floor.id, label: floor.name }))
  );
  readonly setupFloorOptions: PickerOption[] = [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' }
  ];
  readonly areaOptions = computed<PickerOption[]>(() =>
    (['interior', 'exterior', 'shared'] as const).flatMap((group) =>
      this.areaCatalog[group].map((area) => ({
        value: area.kind,
        label: this.areaLabel(area.kind),
        group: this.groupLabel(group)
      }))
    )
  );
  readonly wallKindOptions = computed<PickerOption[]>(() => [
    { value: 'interior', label: this.i18n.t('household.plan_wall_interior') },
    { value: 'exterior', label: this.i18n.t('household.plan_wall_exterior') }
  ]);
  readonly snapshot = signal<VersionedHouseholdPlan>({ version: 0, plan: null });
  readonly assignmentSnapshot = signal<VersionedHouseholdPlanAssignments>({
    planVersion: 0,
    version: 0,
    assignments: {}
  });
  readonly draft = signal<HouseholdPlan>(this.createEmptyPlan());
  readonly selectedFloorId = signal('floor-0');
  readonly selectedSpaceId = signal<string | null>(null);
  readonly assignmentViewActive = signal(false);
  readonly selectedWallId = signal<string | null>(null);
  readonly selectedKind = signal<HouseholdAreaKind>('living_room');
  readonly selectedLabel = signal('');
  readonly selectedWallKind = signal<HouseholdPlanWall['kind']>('interior');
  readonly tool = signal<PlanTool>('select');
  readonly previewMode = signal<PlanPreview>('current');
  readonly proposal = signal<HouseholdPlanProposal | null>(null);
  readonly attachment = signal<File | null>(null);
  readonly prompt = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly proposing = signal(false);
  readonly errorKey = signal<TranslationKey | null>(null);
  readonly noticeKey = signal<TranslationKey | null>(null);
  readonly confirmOrphanedTasks = signal(false);
  readonly orphanedTaskIds = signal<string[]>([]);
  readonly undoStack = signal<HouseholdPlan[]>([]);
  readonly redoStack = signal<HouseholdPlan[]>([]);
  readonly drawingStart = signal<HouseholdPlanPoint | null>(null);
  readonly drawingEnd = signal<HouseholdPlanPoint | null>(null);
  readonly freeformPoints = signal<HouseholdPlanPoint[]>([]);
  readonly snapToGrid = signal(true);
  readonly canvasZoom = signal(100);
  readonly previewZoom = signal(100);
  readonly setupVisible = signal(false);
  readonly selectedEntryMethod = signal<PlanEntryMethod | null>(null);
  readonly setupFloorCount = signal(2);
  readonly assignmentDraftMemberIds = signal<string[]>([]);
  readonly assignmentSaving = signal(false);
  readonly assignmentNoticeKey = signal<TranslationKey | null>(null);
  readonly proposalPresentation = signal<ProposalPresentation>('chat');
  readonly attachmentPreviewUrl = signal<string | null>(null);

  readonly activeFloor = computed(
    () => this.draft().floors.find((floor) => floor.id === this.selectedFloorId()) ?? null
  );
  readonly selectedSpace = computed(
    () => this.shownFloor()?.spaces.find((space) => space.id === this.selectedSpaceId()) ?? null
  );
  readonly selectedWall = computed(
    () => this.shownFloor()?.walls.find((wall) => wall.id === this.selectedWallId()) ?? null
  );
  readonly isDirty = computed(
    () =>
      JSON.stringify(this.draft()) !==
      JSON.stringify(this.snapshot().plan ?? this.createEmptyPlan())
  );
  readonly shownPlan = computed(() => {
    const current = this.previewMode() === 'proposal' ? this.proposal()?.proposal : null;
    return current ?? this.draft();
  });
  readonly shownFloor = computed(() => {
    const floors = this.shownPlan().floors;
    return floors.find((floor) => floor.id === this.selectedFloorId()) ?? floors[0] ?? null;
  });
  get canvasViewBox(): string {
    const floor = this.shownFloor();
    const points = [
      ...(floor?.spaces.flatMap((space) => space.polygon) ?? []),
      ...(floor?.walls.flatMap((wall) => [wall.from, wall.to]) ?? [])
    ];
    if (!points.length) return '0 0 10000 8000';

    const padding = 200;
    let left = Math.max(0, Math.min(...points.map((point) => point.x)) - padding);
    let top = Math.max(0, Math.min(...points.map((point) => point.y)) - padding);
    let right = Math.min(10_000, Math.max(...points.map((point) => point.x)) + padding);
    let bottom = Math.min(10_000, Math.max(...points.map((point) => point.y)) + padding);
    let width = right - left;
    let height = bottom - top;
    const preferredAspectRatio = 1.25;

    if (width / height < preferredAspectRatio) {
      const expandedWidth = Math.min(10_000, Math.ceil(height * preferredAspectRatio));
      const extra = expandedWidth - width;
      left -= extra / 2;
      right += extra / 2;
      width = right - left;
    } else if (width / height > preferredAspectRatio) {
      const expandedHeight = Math.min(10_000, Math.ceil(width / preferredAspectRatio));
      const extra = expandedHeight - height;
      top -= extra / 2;
      bottom += extra / 2;
      height = bottom - top;
    }

    return `${Math.floor(left)} ${Math.floor(top)} ${Math.ceil(width)} ${Math.ceil(height)}`;
  }
  readonly selectedSpaceLabel = computed(() => {
    const selected = this.selectedSpace();
    return selected ? getHouseholdAreaLabel(selected.kind, this.i18n.resolved()) : '';
  });
  readonly assignmentDirty = computed(() => {
    const spaceId = this.selectedSpace()?.id;
    if (!spaceId) return false;
    const saved = this.assignmentSnapshot().assignments[spaceId] ?? [];
    const current = this.assignmentDraftMemberIds();
    return JSON.stringify([...saved].sort()) !== JSON.stringify([...current].sort());
  });
  readonly activeMembers = computed(() =>
    this.members
      .filter((member) => member.isActive)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  readonly assignmentDraftIsShared = computed(() => {
    const members = this.activeMembers();
    const assignedMemberIds = this.assignmentDraftMemberIds();
    return (
      members.length > 1 &&
      assignedMemberIds.length === members.length &&
      members.every((member) => assignedMemberIds.includes(member.userId))
    );
  });
  readonly canApplyProposal = computed(() => {
    const proposal = this.proposal();
    return Boolean(
      this.canEdit &&
      proposal &&
      !this.saving() &&
      (!proposal.orphanedTaskIds.length || this.confirmOrphanedTasks())
    );
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['householdId'] && this.householdId) this.loadPlan();
  }

  loadPlan(): void {
    const generation = ++this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    this.snapshot.set({ version: 0, plan: null });
    this.draft.set(this.createEmptyPlan());
    this.setupVisible.set(false);
    this.assignmentSnapshot.set({ planVersion: 0, version: 0, assignments: {} });
    this.assignmentDraftMemberIds.set([]);
    this.assignmentNoticeKey.set(null);
    this.selectedFloorId.set('floor-0');
    this.resetSelection();
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.proposal.set(null);
    this.orphanedTaskIds.set([]);
    this.confirmOrphanedTasks.set(false);
    this.attachment.set(null);
    this.prompt.set('');
    this.saving.set(false);
    this.proposing.set(false);
    this.loading.set(true);
    this.errorKey.set(null);
    this.planService
      .load(requestedHouseholdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.snapshot.set(snapshot);
          this.draft.set(
            snapshot.plan ? cloneHouseholdPlan(snapshot.plan) : this.createEmptyPlan()
          );
          this.selectedFloorId.set(snapshot.plan?.floors[0]?.id ?? 'floor-0');
          this.selectedSpaceId.set(null);
          this.assignmentViewActive.set(false);
          this.selectedWallId.set(null);
          this.undoStack.set([]);
          this.redoStack.set([]);
          this.proposal.set(null);
          this.setupVisible.set(!snapshot.plan);
          this.loading.set(false);
          this.loadAssignments(generation, requestedHouseholdId);
        },
        error: () => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.loading.set(false);
          this.errorKey.set('household.plan_load_error');
        }
      });
  }

  ngOnDestroy(): void {
    this.revokeAttachmentPreview();
  }

  closeAdvancedSettings(event: Event): void {
    const target = event.target as HTMLElement | null;
    const advancedSettings = target?.closest<HTMLDetailsElement>('.plan-editor__advanced-settings');
    if (advancedSettings && target?.closest('[data-close-advanced-settings]')) {
      advancedSettings.open = false;
      return;
    }
    if (advancedSettings) {
      return;
    }

    const trigger = event.currentTarget as HTMLElement | null;
    const editorSettings = trigger
      ?.closest('.plan-editor')
      ?.querySelector<HTMLDetailsElement>('.plan-editor__advanced-settings');
    if (editorSettings) editorSettings.open = false;
  }

  savePlan(): void {
    if (!this.canEdit || !this.isDirty() || this.saving() || this.proposal()) return;
    const version = this.snapshot().version;
    const generation = this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    const plan = cloneHouseholdPlan(this.draft());
    this.saving.set(true);
    this.resetMessages();
    this.planService
      .save(
        requestedHouseholdId,
        version,
        plan,
        this.confirmOrphanedTasks() ? this.orphanedTaskIds() : []
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.snapshot.set(snapshot);
          this.draft.set(cloneHouseholdPlan(snapshot.plan ?? this.createEmptyPlan()));
          this.undoStack.set([]);
          this.redoStack.set([]);
          this.orphanedTaskIds.set([]);
          this.confirmOrphanedTasks.set(false);
          this.saving.set(false);
          this.noticeKey.set('household.plan_saved');
          this.setupVisible.set(false);
          this.loadAssignments(generation, requestedHouseholdId);
          this.planSaved.emit();
        },
        error: (error: HttpErrorResponse) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.saving.set(false);
          if (error.error?.code === 'PLAN_TASKS_REQUIRE_CONFIRMATION') {
            const ids = error.error?.data?.orphanedTaskIds;
            this.orphanedTaskIds.set(
              Array.isArray(ids) ? ids.filter((id: unknown) => typeof id === 'string') : []
            );
            this.confirmOrphanedTasks.set(false);
            this.errorKey.set('household.plan_orphan_tasks_notice');
          } else {
            this.errorKey.set(
              error.status === 409 ? 'household.plan_conflict' : 'household.plan_save_error'
            );
          }
        }
      });
  }

  discardChanges(): void {
    this.draft.set(
      this.snapshot().plan ? cloneHouseholdPlan(this.snapshot().plan!) : this.createEmptyPlan()
    );
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.proposal.set(null);
    this.orphanedTaskIds.set([]);
    this.confirmOrphanedTasks.set(false);
    this.previewMode.set('current');
    this.selectedSpaceId.set(null);
    this.selectedWallId.set(null);
    this.resetMessages();
  }

  undo(): void {
    const history = this.undoStack();
    const previous = history.at(-1);
    if (!previous) return;
    this.redoStack.update((redo) => [...redo.slice(-19), cloneHouseholdPlan(this.draft())]);
    this.draft.set(previous);
    this.undoStack.set(history.slice(0, -1));
  }

  redo(): void {
    const history = this.redoStack();
    const next = history.at(-1);
    if (!next) return;
    this.undoStack.update((undo) => [...undo.slice(-19), cloneHouseholdPlan(this.draft())]);
    this.draft.set(next);
    this.redoStack.set(history.slice(0, -1));
  }

  addFloor(): void {
    this.addFloorInDirection('above');
  }

  addBasement(): void {
    this.addFloorInDirection('below');
  }

  private addFloorInDirection(direction: 'above' | 'below'): void {
    if (!this.canEdit || this.proposal()) return;
    const floor = createHouseholdPlanFloor(this.draft().floors, direction, this.newId('floor'));
    if (!floor) {
      this.errorKey.set('household.plan_floor_limit');
      return;
    }
    this.updateDraft((plan) => ({ ...plan, floors: [...plan.floors, floor] }));
    this.selectedFloorId.set(floor.id);
    this.resetSelection();
  }

  async removeFloor(): Promise<void> {
    const floor = this.activeFloor();
    if (!this.canEdit || this.proposal() || !floor || this.draft().floors.length <= 1) return;
    const requestedHouseholdId = this.householdId;
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('household.plan_remove_floor_confirm_title'),
      message: this.i18n.t('household.plan_remove_floor_confirm_message', { name: floor.name }),
      confirmText: this.i18n.t('household.plan_remove_floor'),
      variant: 'danger'
    });
    if (
      !accepted ||
      !this.canEdit ||
      this.proposal() ||
      requestedHouseholdId !== this.householdId ||
      !this.draft().floors.some((item) => item.id === floor.id) ||
      this.draft().floors.length <= 1
    )
      return;
    this.updateDraft((plan) => ({
      ...plan,
      floors: plan.floors.filter((item) => item.id !== floor.id)
    }));
    const remaining = this.draft().floors[0];
    this.selectedFloorId.set(remaining.id);
    this.resetSelection();
  }

  renameFloor(name: string): void {
    if (!this.canEdit || this.proposal()) return;
    const floorId = this.selectedFloorId();
    this.updateDraft(
      (plan) => ({
        ...plan,
        floors: plan.floors.map((floor) =>
          floor.id === floorId ? { ...floor, name: name.slice(0, 80) } : floor
        )
      }),
      false
    );
  }

  setDwellingType(type: HouseholdDwellingType): void {
    if (!this.canEdit || this.proposal()) return;
    this.updateDraft((plan) => ({
      ...plan,
      dwellingType: type,
      dwellingTypeLabel: type === 'other' ? plan.dwellingTypeLabel : null
    }));
  }

  setDwellingTypeFromPicker(value: string | null): void {
    if (value && HOUSEHOLD_DWELLING_TYPES.includes(value as HouseholdDwellingType)) {
      this.setDwellingType(value as HouseholdDwellingType);
    }
  }

  setDwellingTypeLabel(label: string): void {
    if (!this.canEdit || this.proposal()) return;
    this.updateDraft((plan) => ({ ...plan, dwellingTypeLabel: label.slice(0, 80) }), false);
  }

  selectEntryMethod(method: PlanEntryMethod): void {
    this.selectedEntryMethod.set(method);
  }

  setSetupDwellingType(type: HouseholdDwellingType): void {
    this.setDwellingType(type);
  }

  setSetupFloorCount(value: string | number): void {
    const count = Number(value);
    if (Number.isInteger(count) && count >= 1 && count <= 12) this.setupFloorCount.set(count);
  }

  startPlan(): void {
    if (!this.canEdit || !this.setupVisible()) return;
    const plan = this.createEmptyPlan();
    plan.dwellingType = this.draft().dwellingType;
    plan.dwellingTypeLabel = this.draft().dwellingTypeLabel;
    if (this.selectedEntryMethod() !== 'photo') {
      plan.floors[0] = this.createStarterFloor(plan.floors[0]);
    }
    while (plan.floors.length < this.setupFloorCount()) {
      const floor = createHouseholdPlanFloor(plan.floors, 'above', this.newId('floor'));
      if (!floor) break;
      plan.floors.push(floor);
    }
    this.draft.set(plan);
    this.selectedFloorId.set(plan.floors[0]?.id ?? 'floor-0');
    this.selectedKind.set('kitchen');
    this.selectedLabel.set(this.areaLabel('kitchen'));
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.setupVisible.set(false);
  }

  setSelectedKind(kind: HouseholdAreaKind): void {
    this.selectedKind.set(kind);
    const label = kind === 'custom' ? '' : getHouseholdAreaLabel(kind, this.i18n.resolved());
    this.selectedLabel.set(label);
  }

  setSelectedKindFromPicker(value: string | null): void {
    if (value && HOUSEHOLD_AREA_KINDS.includes(value as HouseholdAreaKind)) {
      this.setSelectedKind(value as HouseholdAreaKind);
    }
  }

  setSelectedWallKindFromPicker(value: string | null): void {
    if (value === 'interior' || value === 'exterior') this.selectedWallKind.set(value);
  }

  setTool(tool: PlanTool): void {
    if (!this.canEdit || this.proposal()) return;
    this.assignmentViewActive.set(false);
    this.tool.set(tool);
    this.drawingStart.set(null);
    this.drawingEnd.set(null);
    this.freeformPoints.set([]);
  }

  addGuidedSpace(): void {
    const floor = this.activeFloor();
    if (!floor || !this.canEdit || this.proposal()) return;
    if (floor.spaces.length >= 80) {
      this.errorKey.set('household.plan_area_limit');
      return;
    }
    const placement = findGuidedSpacePlacement(floor.spaces);
    if (!placement) {
      this.errorKey.set('household.plan_no_guided_space');
      return;
    }
    const space = createHouseholdPlanSpace(
      this.selectedKind(),
      this.roomLabel(),
      this.newId('space'),
      placement.start,
      placement.end
    );
    if (!space) {
      this.errorKey.set('household.plan_custom_label_required');
      return;
    }
    this.resetMessages();
    this.updateFloor(floor.id, (current) => ({ ...current, spaces: [...current.spaces, space] }));
    this.selectedSpaceId.set(space.id);
    this.selectedWallId.set(null);
  }

  addQuickArea(kind: HouseholdAreaKind): void {
    this.setSelectedKind(kind);
    this.addGuidedSpace();
  }

  bringQuickAreaIntoView(event: FocusEvent): void {
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (!this.canEdit || this.previewMode() === 'proposal') return;
    const svg = event.currentTarget as SVGSVGElement;
    const point = this.pointerPoint(event, svg);
    if (!point) return;
    if (this.tool() === 'freeform') {
      event.preventDefault();
      if (this.freeformPoints().length >= 64) {
        this.errorKey.set('household.plan_polygon_vertex_limit');
        return;
      }
      this.freeformPoints.update((points) => [...points, point]);
      this.resetMessages();
      return;
    }
    if (this.tool() === 'space' || this.tool() === 'wall') {
      event.preventDefault();
      svg.setPointerCapture(event.pointerId);
      this.drawingStart.set(point);
      this.drawingEnd.set(point);
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const spaceId = target?.closest('[data-space-id]')?.getAttribute('data-space-id');
    const wallId = target?.closest('[data-wall-id]')?.getAttribute('data-wall-id');
    if (wallId && this.tool() === 'door') {
      this.selectedWallId.set(wallId);
      this.selectedSpaceId.set(null);
      this.addOpening('door');
      return;
    }
    if (wallId && this.tool() === 'window') {
      this.selectedWallId.set(wallId);
      this.selectedSpaceId.set(null);
      this.addOpening('window');
      return;
    }
    if (spaceId) {
      const selected = this.activeFloor()?.spaces.find((space) => space.id === spaceId);
      if (!selected) return;
      this.selectedSpaceId.set(spaceId);
      this.selectedWallId.set(null);
      this.dragStart = { spaceId, point, space: structuredClone(selected), moved: false };
      svg.setPointerCapture(event.pointerId);
    } else if (wallId) {
      this.selectedWallId.set(wallId);
      this.selectedSpaceId.set(null);
    } else {
      this.resetSelection();
    }
  }

  onCanvasPointerMove(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const point = this.pointerPoint(event, svg);
    if (!point) return;
    if (this.drawingStart()) {
      this.drawingEnd.set(point);
      return;
    }
    if (this.dragStart) {
      const drag = this.dragStart;
      const { spaceId, point: startPoint, space } = drag;
      if (point.x === startPoint.x && point.y === startPoint.y) return;
      if (!drag.moved) {
        drag.moved = true;
        this.pushUndo();
      }
      const moved = moveHouseholdPlanSpace(space, point.x - startPoint.x, point.y - startPoint.y);
      this.updateFloor(
        this.selectedFloorId(),
        (floor) => ({
          ...floor,
          spaces: floor.spaces.map((current) => (current.id === spaceId ? moved : current))
        }),
        false
      );
    }
  }

  onCanvasPointerUp(event: PointerEvent): void {
    const drag = this.dragStart;
    if (event.type === 'pointerup' && drag && !drag.moved && this.tool() === 'select') {
      const selected = this.activeFloor()?.spaces.find((space) => space.id === drag.spaceId);
      if (selected) this.selectSpace(selected);
    }
    const start = this.drawingStart();
    const end = this.drawingEnd();
    if (start && end) {
      if (this.tool() === 'space') this.finishSpace(start, end);
      else if (this.tool() === 'wall') this.finishWall(start, end);
    }
    this.drawingStart.set(null);
    this.drawingEnd.set(null);
    this.dragStart = null;
    const svg = event.currentTarget as SVGSVGElement;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }

  drawingRect(): { x: number; y: number; width: number; height: number } | null {
    const start = this.drawingStart();
    const end = this.drawingEnd();
    if (!start || !end) return null;
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x),
      height: Math.abs(start.y - end.y)
    };
  }

  drawingPolygonPoints(): string {
    return this.freeformPoints()
      .map((point) => `${point.x},${point.y}`)
      .join(' ');
  }

  removeLastFreeformPoint(): void {
    this.freeformPoints.update((points) => points.slice(0, -1));
  }

  cancelFreeformDrawing(): void {
    this.freeformPoints.set([]);
    this.setTool('select');
  }

  finishFreeformSpace(): void {
    const floor = this.activeFloor();
    const points = this.freeformPoints();
    if (!floor || !this.canEdit || this.proposal()) return;
    if (points.length < 3) {
      this.errorKey.set('household.plan_polygon_need_three_points');
      return;
    }
    if (floor.spaces.length >= 80) {
      this.errorKey.set('household.plan_area_limit');
      return;
    }
    const space = createHouseholdPlanPolygon(
      this.selectedKind(),
      this.roomLabel(),
      this.newId('space'),
      points
    );
    if (!space) {
      this.errorKey.set('household.plan_polygon_invalid');
      return;
    }
    this.updateFloor(floor.id, (current) => ({ ...current, spaces: [...current.spaces, space] }));
    this.freeformPoints.set([]);
    this.selectedSpaceId.set(space.id);
    this.selectedWallId.set(null);
    this.selectedLabel.set(space.label);
    this.tool.set('select');
  }

  spacePoints(space: HouseholdPlanSpace): string {
    return space.polygon.map((point) => `${point.x},${point.y}`).join(' ');
  }

  displayedAssignmentMemberIds(spaceId: string): readonly string[] {
    if (this.assignmentViewActive() && this.selectedSpaceId() === spaceId) {
      return this.assignmentDraftMemberIds();
    }
    return this.assignmentSnapshot().assignments[spaceId] ?? [];
  }

  assignmentMemberX(space: HouseholdPlanSpace, memberIndex: number): number {
    const assignedCount = Math.max(1, this.displayedAssignmentMemberIds(space.id).length);
    if (assignedCount === 1) return this.spaceCenter(space).x;
    const bounds = this.spaceBounds(space);
    const radius = this.assignmentMemberRadius(space);
    const spacing = Math.min(
      520,
      Math.max(0, (bounds.maxX - bounds.minX - 2 * radius - 100) / (assignedCount - 1))
    );
    return this.spaceCenter(space).x + (memberIndex - (assignedCount - 1) / 2) * spacing;
  }

  assignmentMemberY(space: HouseholdPlanSpace): number {
    const bounds = this.spaceBounds(space);
    const radius = this.assignmentMemberRadius(space);
    return Math.min(this.spaceCenter(space).y + 1_000, bounds.maxY - radius - 160);
  }

  assignmentMemberRadius(space: HouseholdPlanSpace): number {
    const bounds = this.spaceBounds(space);
    const assignedCount = Math.max(1, this.displayedAssignmentMemberIds(space.id).length);
    const perMemberWidth = (bounds.maxX - bounds.minX - 100) / assignedCount;
    const fontSize = this.spaceLabelFontSize(space);
    const labelHeight = fontSize * this.spaceLabelLines(space).length;
    const gap = this.spaceGlyphLabelGap(space);
    const verticalRadius = Math.floor((bounds.maxY - bounds.minY - labelHeight - gap - 380) / 2);
    return Math.max(60, Math.min(210, Math.floor((perMemberWidth - 120) / 2), verticalRadius));
  }

  spaceCenter(space: HouseholdPlanSpace): HouseholdPlanPoint {
    return polygonCentroid(space.polygon);
  }

  spaceLabelLines(space: HouseholdPlanSpace): string[] {
    const bounds = this.spaceBounds(space);
    const maxCharacters = Math.max(6, Math.floor((bounds.maxX - bounds.minX) / 150));
    const lines: string[] = [];
    let line = '';
    for (const word of space.label.trim().split(/\s+/).filter(Boolean)) {
      if (word.length > maxCharacters) {
        if (line) lines.push(line);
        line = '';
        for (let index = 0; index < word.length; index += maxCharacters) {
          lines.push(word.slice(index, index + maxCharacters));
        }
      } else if (!line) {
        line = word;
      } else if (line.length + word.length + 1 <= maxCharacters) {
        line = `${line} ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length > 3) {
      lines.length = 3;
      lines[2] = `${lines[2].slice(0, Math.max(1, maxCharacters - 1))}…`;
    }
    return lines.length ? lines : [''];
  }

  spaceLabelFontSize(space: HouseholdPlanSpace): number {
    const bounds = this.spaceBounds(space);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const lines = this.spaceLabelLines(space);
    const longestLine = Math.max(...lines.map((line) => line.length), 1);
    const horizontalLimit = (width * 0.8) / (longestLine * 0.6);
    const verticalLimit = height / (lines.length * 2);
    return Math.max(100, Math.floor(Math.min(290, horizontalLimit, verticalLimit)));
  }

  spaceGlyphSize(space: HouseholdPlanSpace): number {
    const bounds = this.spaceBounds(space);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const labelHeight = this.spaceLabelFontSize(space) * this.spaceLabelLines(space).length;
    const naturalSize = Math.max(
      100,
      Math.floor(Math.min(800, width * 0.28, height - labelHeight - 120))
    );
    if (!this.assignmentViewActive() || !this.displayedAssignmentMemberIds(space.id).length) {
      return naturalSize;
    }

    const gap = this.spaceGlyphLabelGap(space);
    const minTop = bounds.minY + 60;
    const markerTop = this.assignmentMemberY(space) - this.assignmentMemberRadius(space);
    const availableSize = markerTop - 60 - minTop - labelHeight - gap;
    return Math.max(100, Math.min(naturalSize, Math.floor(availableSize)));
  }

  spaceGlyphTop(space: HouseholdPlanSpace): number {
    const fontSize = this.spaceLabelFontSize(space);
    const gap = this.spaceGlyphLabelGap(space);
    const labelHeight = fontSize * this.spaceLabelLines(space).length;
    const glyphSize = this.spaceGlyphSize(space);
    const totalHeight = glyphSize + labelHeight + gap;
    const naturalTop = this.spaceCenter(space).y - totalHeight / 2;
    if (!this.assignmentViewActive() || !this.displayedAssignmentMemberIds(space.id).length) {
      return naturalTop;
    }

    const bounds = this.spaceBounds(space);
    const minTop = bounds.minY + 60;
    const maxTop =
      this.assignmentMemberY(space) - this.assignmentMemberRadius(space) - 60 - totalHeight;
    return Math.max(minTop, Math.min(naturalTop, maxTop));
  }

  spaceLabelTop(space: HouseholdPlanSpace): number {
    const fontSize = this.spaceLabelFontSize(space);
    const gap = this.spaceGlyphLabelGap(space);
    return this.spaceGlyphTop(space) + this.spaceGlyphSize(space) + gap + fontSize / 2;
  }

  private spaceGlyphLabelGap(space: HouseholdPlanSpace): number {
    const fontSize = this.spaceLabelFontSize(space);
    const hasAssignments = this.displayedAssignmentMemberIds(space.id).length > 0;
    return this.assignmentViewActive() && hasAssignments
      ? Math.min(90, Math.round(fontSize * 0.31))
      : Math.min(130, Math.round(fontSize * 0.45));
  }

  private spaceBounds(space: HouseholdPlanSpace): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    return {
      minX: Math.min(...space.polygon.map((point) => point.x)),
      maxX: Math.max(...space.polygon.map((point) => point.x)),
      minY: Math.min(...space.polygon.map((point) => point.y)),
      maxY: Math.max(...space.polygon.map((point) => point.y))
    };
  }

  comparisonFloor(plan: HouseholdPlan | null): HouseholdPlanFloor | null {
    if (!plan) return null;
    return (
      plan.floors.find((floor) => floor.id === this.selectedFloorId()) ?? plan.floors[0] ?? null
    );
  }

  setProposalPresentation(presentation: ProposalPresentation): void {
    this.proposalPresentation.set(presentation);
  }

  startPhotoFollowup(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      this.errorKey.set('household.plan_file_too_large');
      input.value = '';
      return;
    }

    this.continueEditingProposal();
    this.onAttachmentChange(event);
  }

  isImageAttachment(): boolean {
    return Boolean(this.attachment()?.type.startsWith('image/'));
  }

  openingLine(
    opening: HouseholdPlanOpening
  ): { from: HouseholdPlanPoint; to: HouseholdPlanPoint } | null {
    return openingSegment(this.shownFloor()?.walls ?? [], opening);
  }

  openingRails(
    opening: HouseholdPlanOpening
  ): Array<{ from: HouseholdPlanPoint; to: HouseholdPlanPoint }> {
    return makeOpeningRails(this.shownFloor()?.walls ?? [], opening);
  }

  doorSwing(opening: HouseholdPlanOpening): {
    hinge: HouseholdPlanPoint;
    leafTip: HouseholdPlanPoint;
    arc: string;
  } | null {
    return makeDoorSwing(this.shownFloor()?.walls ?? [], opening);
  }

  addOpening(kind: HouseholdPlanOpening['kind']): void {
    const floor = this.activeFloor();
    const wall = this.selectedWall();
    if (!this.canEdit || this.proposal() || !floor || !wall || this.previewMode() === 'proposal')
      return;
    if (floor.openings.length >= 300) {
      this.errorKey.set('household.plan_opening_limit');
      return;
    }
    const length = Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y);
    const width = Math.min(900, Math.floor(length / 3));
    if (width < 100) return;
    const isMainEntrance =
      kind === 'door' &&
      wall.kind === 'exterior' &&
      !floor.openings.some((opening) => opening.isMainEntrance);
    const opening: HouseholdPlanOpening = {
      id: this.newId('opening'),
      wallId: wall.id,
      kind,
      offset: Math.floor((length - width) / 2),
      width,
      isMainEntrance
    };
    this.updateFloor(floor.id, (current) => ({
      ...current,
      openings: [...current.openings, opening]
    }));
  }

  removeSelectedWall(): void {
    const floor = this.activeFloor();
    const wall = this.selectedWall();
    if (!this.canEdit || this.proposal() || !floor || !wall) return;
    this.updateFloor(floor.id, (current) => ({
      ...current,
      walls: current.walls.filter((item) => item.id !== wall.id),
      openings: current.openings.filter((item) => item.wallId !== wall.id)
    }));
    this.selectedWallId.set(null);
  }

  updateSelectedLabel(label: string): void {
    const selected = this.selectedSpace();
    if (!selected || !this.canEdit || this.proposal()) return;
    this.selectedLabel.set(label);
    this.updateFloor(
      this.selectedFloorId(),
      (floor) => ({
        ...floor,
        spaces: floor.spaces.map((space) =>
          space.id === selected.id ? { ...space, label: label.slice(0, 100) } : space
        )
      }),
      false
    );
  }

  deleteSelectedSpace(): void {
    const selected = this.selectedSpace();
    if (!selected || !this.canEdit || this.proposal()) return;
    this.updateFloor(this.selectedFloorId(), (floor) => ({
      ...floor,
      spaces: floor.spaces
        .filter((space) => space.id !== selected.id)
        .map((space) =>
          space.parentSpaceId === selected.id ? { ...space, parentSpaceId: null } : space
        )
    }));
    this.selectedSpaceId.set(null);
  }

  selectSpace(space: HouseholdPlanSpace): void {
    this.tool.set('select');
    this.drawingStart.set(null);
    this.drawingEnd.set(null);
    this.selectedSpaceId.set(space.id);
    this.assignmentViewActive.set(true);
    this.selectedWallId.set(null);
    this.selectedLabel.set(space.label);
    this.assignmentDraftMemberIds.set([...(this.assignmentSnapshot().assignments[space.id] ?? [])]);
    this.assignmentNoticeKey.set(null);
  }

  selectSpaceFromCanvas(space: HouseholdPlanSpace): void {
    if (this.tool() !== 'select') return;
    this.selectSpace(space);
  }

  toggleAssignmentMember(memberId: string): void {
    if (!this.activeMembers().some((member) => member.userId === memberId)) return;
    if (this.assignmentDraftIsShared()) {
      this.assignmentDraftMemberIds.set([memberId]);
      this.assignmentNoticeKey.set(null);
      return;
    }
    this.assignmentDraftMemberIds.update((memberIds) =>
      memberIds.includes(memberId)
        ? memberIds.filter((existing) => existing !== memberId)
        : [...memberIds, memberId]
    );
    this.assignmentNoticeKey.set(null);
  }

  saveZoneAssignment(): void {
    const space = this.selectedSpace();
    if (
      !space ||
      !this.canEdit ||
      !this.assignmentDirty() ||
      this.assignmentSaving() ||
      this.proposal()
    )
      return;
    const generation = this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    const memberIds = [...this.assignmentDraftMemberIds()];
    this.assignmentSaving.set(true);
    this.assignmentNoticeKey.set(null);
    this.planService
      .saveAssignment(
        requestedHouseholdId,
        this.assignmentSnapshot().version,
        this.snapshot().version,
        space.id,
        memberIds
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.assignmentSnapshot.set(snapshot);
          this.assignmentDraftMemberIds.set([...(snapshot.assignments[space.id] ?? [])]);
          this.assignmentSaving.set(false);
          this.assignmentNoticeKey.set('household.plan_assignment_saved');
          this.assignmentSaved.emit();
        },
        error: (error: HttpErrorResponse) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.assignmentSaving.set(false);
          this.assignmentNoticeKey.set(
            error.status === 409
              ? 'household.plan_assignment_conflict'
              : error.status === 422
                ? 'household.plan_assignment_member_invalid'
                : 'household.plan_assignment_error'
          );
          if (error.status === 409) this.loadAssignments(generation, requestedHouseholdId);
        }
      });
  }

  selectFloor(floorId: string): void {
    if (!this.shownPlan().floors.some((floor) => floor.id === floorId)) return;
    this.selectedFloorId.set(floorId);
    this.resetSelection();
  }

  openTasksForSelectedSpace(): void {
    const spaceId = this.selectedSpace()?.id;
    if (spaceId) this.zoneTasksSelected.emit(spaceId);
  }

  onAttachmentChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && file.size > 10 * 1024 * 1024) {
      this.revokeAttachmentPreview();
      this.attachment.set(null);
      this.errorKey.set('household.plan_file_too_large');
      input.value = '';
      return;
    }
    this.revokeAttachmentPreview();
    this.attachment.set(file);
    this.attachmentPreviewUrl.set(file ? URL.createObjectURL(file) : null);
    this.errorKey.set(null);
  }

  clearAttachment(input?: HTMLInputElement): void {
    this.revokeAttachmentPreview();
    this.attachment.set(null);
    if (input) input.value = '';
  }

  requestProposal(): void {
    const prompt = this.prompt().trim();
    const file = this.attachment();
    if (!this.canEdit || (!prompt && !file) || this.proposing() || this.saving()) return;
    const generation = this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    this.proposing.set(true);
    this.resetMessages();
    this.planService
      .propose({
        householdId: requestedHouseholdId,
        baseVersion: this.snapshot().version,
        prompt,
        attachment: file,
        draftPlan: cloneHouseholdPlan(this.draft())
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (proposal) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.proposal.set(proposal);
          this.previewMode.set('proposal');
          this.proposalPresentation.set(file ? 'photo' : 'chat');
          this.confirmOrphanedTasks.set(false);
          this.proposing.set(false);
        },
        error: (error: HttpErrorResponse) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.proposing.set(false);
          this.errorKey.set(this.proposalErrorKey(error));
        }
      });
  }

  applyProposal(): void {
    const proposal = this.proposal();
    if (!proposal || !this.canApplyProposal()) return;
    const generation = this.requestGeneration;
    const requestedHouseholdId = this.householdId;
    this.saving.set(true);
    this.resetMessages();
    this.planService
      .save(requestedHouseholdId, proposal.baseVersion, proposal.proposal, proposal.orphanedTaskIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.snapshot.set(snapshot);
          this.draft.set(cloneHouseholdPlan(snapshot.plan ?? this.createEmptyPlan()));
          this.proposal.set(null);
          this.orphanedTaskIds.set([]);
          this.confirmOrphanedTasks.set(false);
          this.previewMode.set('current');
          this.undoStack.set([]);
          this.redoStack.set([]);
          this.saving.set(false);
          this.noticeKey.set('household.plan_proposal_applied');
          this.setupVisible.set(false);
          this.loadAssignments(generation, requestedHouseholdId);
          this.planSaved.emit();
        },
        error: (error: HttpErrorResponse) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.saving.set(false);
          this.errorKey.set(
            error.status === 409 ? 'household.plan_conflict' : 'household.plan_save_error'
          );
        }
      });
  }

  discardProposal(): void {
    this.proposal.set(null);
    this.previewMode.set('current');
    this.confirmOrphanedTasks.set(false);
  }

  continueEditingProposal(preservePrompt = false): void {
    const proposal = this.proposal();
    if (!proposal || this.saving() || this.proposing()) return;

    this.pushUndo();
    this.draft.set(cloneHouseholdPlan(proposal.proposal));
    this.selectedFloorId.set(proposal.proposal.floors[0]?.id ?? 'floor-0');
    this.resetSelection();
    this.proposal.set(null);
    this.previewMode.set('current');
    this.orphanedTaskIds.set([...proposal.orphanedTaskIds]);
    this.confirmOrphanedTasks.set(false);
    if (!preservePrompt) this.prompt.set('');
    this.clearAttachment();
    this.proposalPresentation.set('chat');
    this.setupVisible.set(false);
    this.resetMessages();
  }

  setPreviewMode(mode: PlanPreview): void {
    if (mode === 'proposal' && !this.proposal()) return;
    this.previewMode.set(mode);
    const floors = this.shownPlan().floors;
    if (!floors.some((floor) => floor.id === this.selectedFloorId())) {
      this.selectedFloorId.set(floors[0]?.id ?? 'floor-0');
      this.resetSelection();
    }
  }

  areaLabel(kind: HouseholdAreaKind): string {
    return getHouseholdAreaLabel(kind, this.i18n.resolved());
  }

  chatProposalMessage(added: number, changed: number): string {
    const addedLabel = this.i18n.plural(
      added,
      'household.plan_chat_added_area_uno',
      'household.plan_chat_added_area_varios'
    );
    const changedLabel = this.i18n.plural(
      changed,
      'household.plan_chat_modified_area_uno',
      'household.plan_chat_modified_area_varios'
    );
    return this.i18n.t('household.plan_chat_proposal_message', {
      added,
      addedLabel,
      changed,
      changedLabel
    });
  }

  dwellingTypeLabel(type: HouseholdDwellingType): string {
    return this.i18n.t(DWELLING_TYPE_KEYS[type]);
  }

  dwellingCardLabel(type: 'apartment' | 'detached_house' | 'terraced_house' | 'other'): string {
    return this.i18n.t(DWELLING_CARD_LABEL_KEYS[type]);
  }

  memberName(memberId: string): string {
    return this.members.find((member) => member.userId === memberId)?.name ?? '';
  }

  memberInitials(memberId: string): string {
    return this.memberName(memberId)
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase() ?? '')
      .join('');
  }

  memberIndexForId(memberId: string): number {
    return this.activeMembers().findIndex((member) => member.userId === memberId);
  }

  spaceResponsibilityClass(spaceId: string): string {
    const memberIds = this.displayedAssignmentMemberIds(spaceId);
    if (memberIds.length > 1) return 'plan-canvas__space--shared';
    if (!memberIds.length) return '';
    const memberIndex = this.memberIndexForId(memberIds[0]);
    return memberIndex < 0 ? '' : `plan-canvas__space--member-${memberIndex % 4}`;
  }

  closeSpaceDetails(): void {
    this.selectedSpaceId.set(null);
    this.assignmentViewActive.set(false);
    this.assignmentDraftMemberIds.set([]);
    this.assignmentNoticeKey.set(null);
  }

  setZoneShared(): void {
    this.assignmentDraftMemberIds.set(this.activeMembers().map((member) => member.userId));
    this.assignmentNoticeKey.set(null);
  }

  changeCanvasZoom(amount: number): void {
    this.canvasZoom.update((zoom) => Math.min(150, Math.max(50, zoom + amount)));
  }

  changePreviewZoom(amount: number): void {
    this.previewZoom.update((zoom) => Math.min(150, Math.max(50, zoom + amount)));
  }

  resetPreviewZoom(): void {
    this.previewZoom.set(100);
  }

  groupLabel(group: 'interior' | 'exterior' | 'shared'): string {
    return getHouseholdAreaGroupLabel(group, this.i18n.resolved());
  }

  wallLength(wall: HouseholdPlanWall): number {
    return Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y);
  }

  private finishSpace(start: HouseholdPlanPoint, end: HouseholdPlanPoint): void {
    const floor = this.activeFloor();
    if (!floor) return;
    if (floor.spaces.length >= 80) {
      this.errorKey.set('household.plan_area_limit');
      return;
    }
    const space = createHouseholdPlanSpace(
      this.selectedKind(),
      this.roomLabel(),
      this.newId('space'),
      start,
      end
    );
    if (!space) {
      this.errorKey.set('household.plan_shape_too_small');
      return;
    }
    this.updateFloor(floor.id, (current) => ({ ...current, spaces: [...current.spaces, space] }));
    this.selectSpace(space);
    this.tool.set('select');
  }

  private finishWall(start: HouseholdPlanPoint, end: HouseholdPlanPoint): void {
    const floor = this.activeFloor();
    if (!floor) return;
    if (floor.walls.length >= 250) {
      this.errorKey.set('household.plan_wall_limit');
      return;
    }
    const wall = createHouseholdPlanWall(this.newId('wall'), this.selectedWallKind(), start, end);
    if (!wall) {
      this.errorKey.set('household.plan_shape_too_small');
      return;
    }
    this.updateFloor(floor.id, (current) => ({ ...current, walls: [...current.walls, wall] }));
    this.selectedWallId.set(wall.id);
    this.selectedSpaceId.set(null);
    this.tool.set('select');
  }

  private updateFloor(
    floorId: string,
    update: (floor: HouseholdPlanFloor) => HouseholdPlanFloor,
    record = true
  ): void {
    if (record) this.pushUndo();
    this.updateDraft(
      (plan) => ({
        ...plan,
        floors: plan.floors.map((floor) => (floor.id === floorId ? update(floor) : floor))
      }),
      false
    );
  }

  private updateDraft(update: (plan: HouseholdPlan) => HouseholdPlan, record = true): void {
    if (!this.canEdit || this.proposal()) return;
    if (record) this.pushUndo();
    this.draft.set(update(this.draft()));
    this.resetMessages();
  }

  private pushUndo(): void {
    this.undoStack.update((history) => [...history.slice(-19), cloneHouseholdPlan(this.draft())]);
    this.redoStack.set([]);
  }

  private pointerPoint(event: PointerEvent, svg: SVGSVGElement): HouseholdPlanPoint | null {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const coordinate = (value: number): number =>
      clampCoordinate(this.snapToGrid() ? Math.round(value / 200) * 200 : value);
    const screenMatrix = svg.getScreenCTM?.();
    if (screenMatrix && svg.createSVGPoint) {
      const screenPoint = svg.createSVGPoint();
      screenPoint.x = event.clientX;
      screenPoint.y = event.clientY;
      const planPoint = screenPoint.matrixTransform(screenMatrix.inverse());
      return { x: coordinate(planPoint.x), y: coordinate(planPoint.y) };
    }

    const viewBox = svg.viewBox?.baseVal;
    const viewX = viewBox?.width ? viewBox.x : 0;
    const viewY = viewBox?.height ? viewBox.y : 0;
    const viewWidth = viewBox?.width || 10_000;
    const viewHeight = viewBox?.height || 10_000;
    return {
      x: coordinate(viewX + ((event.clientX - bounds.left) / bounds.width) * viewWidth),
      y: coordinate(viewY + ((event.clientY - bounds.top) / bounds.height) * viewHeight)
    };
  }

  private roomLabel(): string {
    return this.selectedKind() === 'custom'
      ? this.selectedLabel().trim()
      : getHouseholdAreaLabel(this.selectedKind(), this.i18n.resolved());
  }

  private newId(prefix: string): string {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
  }

  private createEmptyPlan(): HouseholdPlan {
    return emptyHouseholdPlan(this.i18n.t('household.plan_default_floor'));
  }

  private createStarterFloor(floor: HouseholdPlanFloor): HouseholdPlanFloor {
    const starterFootprintYScale = 1.35;
    const scalePoint = (point: HouseholdPlanPoint): HouseholdPlanPoint => ({
      x: point.x,
      y: Math.round(5_000 + (point.y - 5_000) * starterFootprintYScale)
    });
    const spaces: Array<[HouseholdAreaKind, string, HouseholdPlanPoint, HouseholdPlanPoint]> = [
      ['kitchen', this.areaLabel('kitchen'), { x: 300, y: 1_400 }, { x: 3_600, y: 4_000 }],
      [
        'living_room',
        this.areaLabel('living_room'),
        { x: 3_600, y: 1_400 },
        { x: 7_600, y: 4_400 }
      ],
      ['bathroom', this.areaLabel('bathroom'), { x: 300, y: 4_000 }, { x: 3_000, y: 5_600 }],
      ['bedroom', this.areaLabel('bedroom'), { x: 300, y: 5_600 }, { x: 4_300, y: 8_600 }],
      ['entrance', this.areaLabel('entrance'), { x: 4_300, y: 4_400 }, { x: 7_600, y: 8_600 }],
      ['patio', this.areaLabel('patio'), { x: 7_600, y: 1_400 }, { x: 9_700, y: 6_000 }],
      ['garden', this.areaLabel('garden'), { x: 7_600, y: 6_000 }, { x: 9_700, y: 8_600 }]
    ];
    const irregularShapes: Partial<Record<HouseholdAreaKind, HouseholdPlanPoint[]>> = {
      bedroom: [
        { x: 300, y: 5_600 },
        { x: 4_300, y: 5_600 },
        { x: 4_300, y: 8_600 },
        { x: 500, y: 8_600 }
      ],
      patio: [
        { x: 7_600, y: 1_400 },
        { x: 9_700, y: 1_700 },
        { x: 9_700, y: 5_600 },
        { x: 7_600, y: 6_000 }
      ],
      garden: [
        { x: 7_600, y: 6_000 },
        { x: 9_700, y: 5_600 },
        { x: 9_700, y: 8_600 },
        { x: 7_600, y: 8_600 }
      ]
    };
    const roomSpaces = spaces
      .map(([kind, label, from, to]) => {
        const id = this.newId('space');
        const polygon = irregularShapes[kind];
        return polygon
          ? createHouseholdPlanPolygon(kind, label, id, polygon.map(scalePoint))
          : createHouseholdPlanSpace(kind, label, id, scalePoint(from), scalePoint(to));
      })
      .filter((space): space is HouseholdPlanSpace => space !== null);
    const wallSegments: Array<['interior' | 'exterior', HouseholdPlanPoint, HouseholdPlanPoint]> = [
      ['exterior', { x: 300, y: 1_400 }, { x: 7_600, y: 1_400 }],
      ['exterior', { x: 300, y: 1_400 }, { x: 300, y: 5_600 }],
      ['exterior', { x: 500, y: 8_600 }, { x: 7_600, y: 8_600 }],
      ['exterior', { x: 7_600, y: 1_400 }, { x: 7_600, y: 8_600 }],
      ['interior', { x: 3_600, y: 1_400 }, { x: 3_600, y: 4_000 }],
      ['interior', { x: 300, y: 4_000 }, { x: 3_600, y: 4_000 }],
      ['interior', { x: 3_000, y: 4_000 }, { x: 3_000, y: 5_600 }],
      ['interior', { x: 300, y: 5_600 }, { x: 4_300, y: 5_600 }],
      ['interior', { x: 4_300, y: 5_600 }, { x: 4_300, y: 8_600 }],
      ['interior', { x: 3_600, y: 4_400 }, { x: 7_600, y: 4_400 }],
      ['exterior', { x: 300, y: 5_600 }, { x: 500, y: 8_600 }]
    ];
    const walls = wallSegments.map(([kind, from, to]) => ({
      id: this.newId('wall'),
      kind,
      from: scalePoint(from),
      to: scalePoint(to)
    }));
    const wallForSource = (matches: (segment: (typeof wallSegments)[number]) => boolean) => {
      const index = wallSegments.findIndex(matches);
      return index < 0 ? undefined : walls[index];
    };
    const openingOn = (
      wall: (typeof walls)[number] | undefined,
      kind: HouseholdPlanOpening['kind'],
      offset: number,
      width: number,
      isMainEntrance = false
    ): HouseholdPlanOpening | null => {
      if (!wall) return null;
      const sourceSegment = wallSegments[walls.indexOf(wall)];
      const sourceLength = sourceSegment
        ? Math.hypot(
            sourceSegment[2].x - sourceSegment[1].x,
            sourceSegment[2].y - sourceSegment[1].y
          )
        : 0;
      const scaledLength = Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y);
      const lengthScale = sourceLength > 0 ? scaledLength / sourceLength : 1;
      return {
        id: this.newId('opening'),
        wallId: wall.id,
        kind,
        offset: Math.round(offset * lengthScale),
        width: Math.round(width * lengthScale),
        isMainEntrance
      };
    };
    const openings = [
      openingOn(
        wallForSource(
          ([kind, from, to]) => kind === 'exterior' && from.y === 8_600 && to.y === 8_600
        ),
        'door',
        4_900,
        900,
        true
      ),
      openingOn(walls[4], 'door', 1_450, 750),
      openingOn(walls[6], 'door', 350, 700),
      openingOn(walls[7], 'door', 2_550, 800),
      openingOn(walls[0], 'window', 800, 1_200),
      openingOn(walls[1], 'window', 2_400, 1_100),
      openingOn(walls[2], 'window', 1_150, 1_200)
    ].filter((opening): opening is HouseholdPlanOpening => opening !== null);
    return { ...floor, walls, openings, spaces: roomSpaces };
  }

  private loadAssignments(generation: number, requestedHouseholdId: string): void {
    this.planService
      .loadAssignments(requestedHouseholdId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.assignmentSnapshot.set(snapshot);
          const spaceId = this.selectedSpace()?.id;
          if (spaceId) {
            this.assignmentDraftMemberIds.set([...(snapshot.assignments[spaceId] ?? [])]);
          }
        },
        error: () => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.assignmentSnapshot.set({
            planVersion: this.snapshot().version,
            version: 0,
            assignments: {}
          });
        }
      });
  }

  private revokeAttachmentPreview(): void {
    const url = this.attachmentPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.attachmentPreviewUrl.set(null);
  }

  private resetSelection(): void {
    this.selectedSpaceId.set(null);
    this.assignmentViewActive.set(false);
    this.selectedWallId.set(null);
  }

  private resetMessages(): void {
    this.errorKey.set(null);
    this.noticeKey.set(null);
  }

  private isCurrentRequest(generation: number, householdId: string): boolean {
    return generation === this.requestGeneration && householdId === this.householdId;
  }

  private proposalErrorKey(error: HttpErrorResponse): TranslationKey {
    if (error.status === 409) return 'household.plan_conflict';
    if (error.error?.code === 'AI_CONFIGURATION_REQUIRED')
      return 'household.plan_ai_config_required';
    if (error.error?.code === 'AI_PROVIDER_TIMEOUT') return 'household.plan_ai_timeout';
    if (error.error?.code === 'AI_PROPOSAL_INVALID') return 'household.plan_ai_invalid';
    if (error.error?.code === 'AI_REQUEST_CANCELLED') return 'household.plan_ai_cancelled';
    if (error.error?.code === 'HOUSEHOLD_SETTINGS_REQUIRED') return 'household.plan_read_only';
    return 'household.plan_ai_error';
  }
}
