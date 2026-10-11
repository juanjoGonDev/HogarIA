import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
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
import {
  HOUSEHOLD_AREA_KINDS,
  HOUSEHOLD_DWELLING_TYPES
} from '../../shared/models/household-plan.model';
import {
  cloneHouseholdPlan,
  clampCoordinate,
  createHouseholdPlanFloor,
  createHouseholdPlanSpace,
  createHouseholdPlanWall,
  emptyHouseholdPlan,
  moveHouseholdPlanSpace,
  openingSegment
} from './household-plan-editor.utils';

type PlanTool = 'select' | 'space' | 'wall';
type PlanPreview = 'current' | 'proposal';

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

@Component({
  selector: 'app-household-plan-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, PickerComponent],
  templateUrl: './household-plan-editor.component.html',
  styleUrl: './household-plan-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdPlanEditorComponent implements OnChanges {
  @Input({ required: true }) householdId = '';
  @Input() canEdit = false;
  @Output() readonly planSaved = new EventEmitter<void>();
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
  readonly dwellingTypeOptions = computed<PickerOption[]>(() =>
    this.dwellingTypes.map((type) => ({
      value: type,
      label: this.i18n.t(DWELLING_TYPE_KEYS[type])
    }))
  );
  readonly floorOptions = computed<PickerOption[]>(() =>
    this.shownPlan().floors.map((floor) => ({ value: floor.id, label: floor.name }))
  );
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
  readonly draft = signal<HouseholdPlan>(this.createEmptyPlan());
  readonly selectedFloorId = signal('floor-0');
  readonly selectedSpaceId = signal<string | null>(null);
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
  readonly drawingStart = signal<HouseholdPlanPoint | null>(null);
  readonly drawingEnd = signal<HouseholdPlanPoint | null>(null);

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
  readonly selectedSpaceLabel = computed(() => {
    const selected = this.selectedSpace();
    return selected ? getHouseholdAreaLabel(selected.kind, this.i18n.resolved()) : '';
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
    this.selectedFloorId.set('floor-0');
    this.resetSelection();
    this.undoStack.set([]);
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
          this.selectedWallId.set(null);
          this.undoStack.set([]);
          this.proposal.set(null);
          this.loading.set(false);
        },
        error: () => {
          if (!this.isCurrentRequest(generation, requestedHouseholdId)) return;
          this.loading.set(false);
          this.errorKey.set('household.plan_load_error');
        }
      });
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
          this.orphanedTaskIds.set([]);
          this.confirmOrphanedTasks.set(false);
          this.saving.set(false);
          this.noticeKey.set('household.plan_saved');
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
    this.draft.set(previous);
    this.undoStack.set(history.slice(0, -1));
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
    this.tool.set(tool);
    this.drawingStart.set(null);
    this.drawingEnd.set(null);
  }

  addGuidedSpace(): void {
    const floor = this.activeFloor();
    if (!floor || !this.canEdit || this.proposal()) return;
    if (floor.spaces.length >= 80) {
      this.errorKey.set('household.plan_area_limit');
      return;
    }
    const index = floor.spaces.length;
    const left = 150 + (index % 5) * 1_970;
    const top = 150 + Math.floor(index / 5) * 620;
    const space = createHouseholdPlanSpace(
      this.selectedKind(),
      this.roomLabel(),
      this.newId('space'),
      { x: left, y: top },
      { x: left + 1_800, y: top + 480 }
    );
    if (!space) {
      this.errorKey.set('household.plan_custom_label_required');
      return;
    }
    this.updateFloor(floor.id, (current) => ({ ...current, spaces: [...current.spaces, space] }));
    this.selectedSpaceId.set(space.id);
    this.selectedWallId.set(null);
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (!this.canEdit || this.previewMode() === 'proposal') return;
    const svg = event.currentTarget as SVGSVGElement;
    const point = this.pointerPoint(event, svg);
    if (!point) return;
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

  spacePoints(space: HouseholdPlanSpace): string {
    return space.polygon.map((point) => `${point.x},${point.y}`).join(' ');
  }

  openingLine(
    opening: HouseholdPlanOpening
  ): { from: HouseholdPlanPoint; to: HouseholdPlanPoint } | null {
    return openingSegment(this.shownFloor()?.walls ?? [], opening);
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
    const length = Math.abs(wall.to.x - wall.from.x) + Math.abs(wall.to.y - wall.from.y);
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
    this.selectedSpaceId.set(space.id);
    this.selectedWallId.set(null);
    this.selectedLabel.set(space.label);
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
      this.attachment.set(null);
      this.errorKey.set('household.plan_file_too_large');
      input.value = '';
      return;
    }
    this.attachment.set(file);
    this.errorKey.set(null);
  }

  clearAttachment(input?: HTMLInputElement): void {
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
          this.saving.set(false);
          this.noticeKey.set('household.plan_proposal_applied');
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

  groupLabel(group: 'interior' | 'exterior' | 'shared'): string {
    return getHouseholdAreaGroupLabel(group, this.i18n.resolved());
  }

  wallLength(wall: HouseholdPlanWall): number {
    return Math.abs(wall.to.x - wall.from.x) + Math.abs(wall.to.y - wall.from.y);
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
  }

  private pointerPoint(event: PointerEvent, svg: SVGSVGElement): HouseholdPlanPoint | null {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: clampCoordinate(((event.clientX - bounds.left) / bounds.width) * 10_000),
      y: clampCoordinate(((event.clientY - bounds.top) / bounds.height) * 10_000)
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

  private resetSelection(): void {
    this.selectedSpaceId.set(null);
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
