import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { HouseholdPlanService } from '../../core/services/household-plan.service';
import { ConfirmService } from '../../core/services/confirm.service';
import type { TranslationKey } from '../../core/i18n';
import type {
  HouseholdPlan,
  HouseholdPlanProposal,
  VersionedHouseholdPlan
} from '../../shared/models/household-plan.model';
import { emptyHouseholdPlan } from './household-plan-editor.utils';
import { HouseholdPlanEditorComponent } from './household-plan-editor.component';

describe('HouseholdPlanEditorComponent', () => {
  let fixture: ComponentFixture<HouseholdPlanEditorComponent>;
  let component: HouseholdPlanEditorComponent;
  let planService: jasmine.SpyObj<HouseholdPlanService>;
  let confirmService: jasmine.SpyObj<ConfirmService>;

  const emptySnapshot: VersionedHouseholdPlan = { version: 0, plan: null };
  const i18n = {
    resolved: signal<'es' | 'en'>('es'),
    changeTick: signal(0),
    t: (key: string) => key
  };

  function fakeCanvas(width = 100, height = 100): SVGSVGElement {
    return {
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
      setPointerCapture: jasmine.createSpy('setPointerCapture'),
      hasPointerCapture: jasmine.createSpy('hasPointerCapture').and.returnValue(true),
      releasePointerCapture: jasmine.createSpy('releasePointerCapture')
    } as unknown as SVGSVGElement;
  }

  function pointer(
    canvas: SVGSVGElement,
    target: EventTarget,
    clientX: number,
    clientY: number
  ): PointerEvent {
    return {
      currentTarget: canvas,
      target,
      clientX,
      clientY,
      pointerId: 1,
      preventDefault: jasmine.createSpy('preventDefault')
    } as unknown as PointerEvent;
  }

  async function mount(canEdit = true): Promise<void> {
    planService = jasmine.createSpyObj<HouseholdPlanService>('HouseholdPlanService', [
      'load',
      'save',
      'propose'
    ]);
    planService.load.and.returnValue(of(emptySnapshot));
    planService.save.and.returnValue(of(emptySnapshot));
    planService.propose.and.returnValue(throwError(() => new Error('unexpected proposal')));
    confirmService = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirmService.confirm.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [HouseholdPlanEditorComponent],
      providers: [
        { provide: HouseholdPlanService, useValue: planService },
        { provide: ConfirmService, useValue: confirmService },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdPlanEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'synthetic-home');
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('loads a home plan and prevents read-only members from changing or saving it', async () => {
    await mount(false);

    expect(planService.load).toHaveBeenCalledOnceWith('synthetic-home');
    const before = structuredClone(component.draft());
    component.addGuidedSpace();
    component.savePlan();

    expect(component.draft()).toEqual(before);
    expect(planService.save).not.toHaveBeenCalled();
  });

  it('keeps edits local, supports undo and only persists after an explicit save', async () => {
    await mount();
    planService.save.and.callFake((_householdId, _version, plan) => of({ version: 1, plan }));

    component.addGuidedSpace();
    expect(component.draft().floors[0].spaces).toHaveSize(1);
    expect(component.snapshot()).toEqual(emptySnapshot);

    component.undo();
    expect(component.draft().floors[0].spaces).toHaveSize(0);
    component.addGuidedSpace();
    const editedPlan = structuredClone(component.draft());
    component.savePlan();

    expect(planService.save).toHaveBeenCalledOnceWith('synthetic-home', 0, editedPlan, []);
    expect(editedPlan.floors[0].spaces[0].label).toBe('Salón');
    expect(component.snapshot()).toEqual({ version: 1, plan: editedPlan });
    expect(component.isDirty()).toBeFalse();
  });

  it('requires confirmation before removing a floor and leaves it intact on cancellation', async () => {
    await mount();
    component.addFloor();
    expect(component.draft().floors).toHaveSize(2);
    confirmService.confirm.and.returnValues(Promise.resolve(false), Promise.resolve(true));

    await component.removeFloor();
    expect(component.draft().floors).toHaveSize(2);

    await component.removeFloor();
    expect(component.draft().floors).toHaveSize(1);
    expect(confirmService.confirm).toHaveBeenCalledTimes(2);
  });

  it('sends the unsaved draft for AI review and does not persist until the proposal is applied', async () => {
    await mount();
    component.setSelectedKind('kitchen');
    component.addGuidedSpace();
    component.prompt.set('Añade una entrada principal');
    const proposed = structuredClone(component.draft());
    const result: HouseholdPlanProposal = {
      baseVersion: 0,
      current: null,
      draft: structuredClone(proposed),
      proposal: proposed,
      diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
      orphanedTaskIds: ['linked-task']
    };
    planService.propose.and.returnValue(of(result));
    planService.save.and.returnValue(of({ version: 1, plan: proposed }));

    component.requestProposal();

    expect(planService.propose).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        householdId: 'synthetic-home',
        baseVersion: 0,
        prompt: 'Añade una entrada principal',
        draftPlan: jasmine.objectContaining({
          floors: jasmine.arrayContaining([
            jasmine.objectContaining({ spaces: jasmine.any(Array) })
          ])
        })
      })
    );
    expect(planService.save).not.toHaveBeenCalled();
    expect(component.proposal()).toEqual(result);
    expect(component.canApplyProposal()).toBeFalse();
    component.applyProposal();
    expect(planService.save).not.toHaveBeenCalled();
    component.confirmOrphanedTasks.set(true);
    expect(component.canApplyProposal()).toBeTrue();
    component.applyProposal();
    expect(planService.save).toHaveBeenCalledOnceWith('synthetic-home', 0, proposed, [
      'linked-task'
    ]);
    expect(component.proposal()).toBeNull();
  });

  it('asks for explicit confirmation before saving a manual edit that detaches tasks', async () => {
    await mount();
    component.addGuidedSpace();
    planService.save.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              code: 'PLAN_TASKS_REQUIRE_CONFIRMATION',
              data: { orphanedTaskIds: ['task-linked-to-removed-area'] }
            }
          })
      )
    );

    component.savePlan();

    expect(component.orphanedTaskIds()).toEqual(['task-linked-to-removed-area']);
    expect(component.errorKey()).toBe('household.plan_orphan_tasks_notice');
    expect(component.confirmOrphanedTasks()).toBeFalse();
    component.confirmOrphanedTasks.set(true);
    planService.save.and.returnValue(of({ version: 1, plan: component.draft() }));
    component.savePlan();
    expect(planService.save).toHaveBeenCalledWith('synthetic-home', 0, jasmine.any(Object), [
      'task-linked-to-removed-area'
    ]);
    expect(component.orphanedTaskIds()).toEqual([]);
  });

  it('ignores a late load response after the selected household changes', async () => {
    const first = new Subject<VersionedHouseholdPlan>();
    const second = new Subject<VersionedHouseholdPlan>();
    confirmService = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirmService.confirm.and.returnValue(Promise.resolve(true));
    planService = jasmine.createSpyObj<HouseholdPlanService>('HouseholdPlanService', [
      'load',
      'save',
      'propose'
    ]);
    planService.load.and.returnValues(first, second);
    planService.save.and.returnValue(of(emptySnapshot));
    planService.propose.and.returnValue(throwError(() => new Error('unused')));
    await TestBed.configureTestingModule({
      imports: [HouseholdPlanEditorComponent],
      providers: [
        { provide: HouseholdPlanService, useValue: planService },
        { provide: ConfirmService, useValue: confirmService },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HouseholdPlanEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'home-one');
    fixture.detectChanges();
    fixture.componentRef.setInput('householdId', 'home-two');
    fixture.detectChanges();

    const foreignPlan = emptyHouseholdPlan('Planta baja');
    foreignPlan.summary = 'plan from previous home';
    first.next({ version: 9, plan: foreignPlan });
    second.next(emptySnapshot);

    expect(component.snapshot()).toEqual(emptySnapshot);
    expect(component.draft().summary).toBe('');
  });

  it('draws and moves vector spaces and walls, places openings and supports canvas selection', async () => {
    await mount();
    const canvas = fakeCanvas();
    const emptyTarget = document.createElement('div');

    component.setSelectedKindFromPicker('custom');
    component.addGuidedSpace();
    expect(component.errorKey()).toBe('household.plan_custom_label_required');
    component.selectedLabel.set('Rincón de lectura');
    component.addGuidedSpace();
    expect(component.draft().floors[0].spaces[0].label).toBe('Rincón de lectura');

    component.setSelectedKindFromPicker('kitchen');
    component.setTool('space');
    component.onCanvasPointerDown(pointer(canvas, emptyTarget, 10, 10));
    expect(component.drawingRect()).toEqual({ x: 1000, y: 1000, width: 0, height: 0 });
    component.onCanvasPointerMove(pointer(canvas, emptyTarget, 60, 55));
    expect(component.drawingRect()).toEqual({ x: 1000, y: 1000, width: 5000, height: 4500 });
    component.onCanvasPointerUp(pointer(canvas, emptyTarget, 60, 55));
    expect(component.draft().floors[0].spaces).toHaveSize(2);
    expect(component.tool()).toBe('select');

    component.setSelectedWallKindFromPicker('exterior');
    component.setTool('wall');
    component.onCanvasPointerDown(pointer(canvas, emptyTarget, 15, 75));
    component.onCanvasPointerMove(pointer(canvas, emptyTarget, 90, 75));
    component.onCanvasPointerUp(pointer(canvas, emptyTarget, 90, 75));
    expect(component.draft().floors[0].walls).toHaveSize(1);
    expect(component.selectedWall()?.kind).toBe('exterior');
    component.addOpening('door');
    component.addOpening('window');
    expect(component.draft().floors[0].openings.map((opening) => opening.isMainEntrance)).toEqual([
      true,
      false
    ]);
    expect(component.openingLine(component.draft().floors[0].openings[0])).not.toBeNull();

    const wallTarget = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    wallTarget.setAttribute('data-wall-id', component.draft().floors[0].walls[0].id);
    component.onCanvasPointerDown(pointer(canvas, wallTarget, 15, 75));
    expect(component.selectedWall()).not.toBeNull();
    component.removeSelectedWall();
    expect(component.draft().floors[0].walls).toHaveSize(0);
    expect(component.draft().floors[0].openings).toHaveSize(0);

    const area = component.draft().floors[0].spaces[1];
    const areaTarget = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    areaTarget.setAttribute('data-space-id', area.id);
    component.onCanvasPointerDown(pointer(canvas, areaTarget, 20, 20));
    component.onCanvasPointerMove(pointer(canvas, areaTarget, 25, 25));
    component.onCanvasPointerUp(pointer(canvas, areaTarget, 25, 25));
    expect(component.selectedSpace()?.id).toBe(area.id);
    expect(component.draft().floors[0].spaces[1].polygon[0]).toEqual({ x: 1500, y: 1500 });
    expect(component.undoStack().length).toBeGreaterThan(0);

    component.onCanvasPointerDown(pointer(canvas, emptyTarget, 5, 5));
    expect(component.selectedSpace()).toBeNull();
    expect(component.selectedWall()).toBeNull();
    expect(
      component.wallLength({
        id: 'line',
        kind: 'interior',
        from: { x: 0, y: 0 },
        to: { x: 0, y: 500 }
      })
    ).toBe(500);
  });

  it('validates picker values, labels, floor/space limits and stale selections', async () => {
    await mount();
    component.setDwellingTypeFromPicker('not-a-dwelling');
    expect(component.draft().dwellingType).toBe('apartment');
    component.setDwellingTypeFromPicker('other');
    component.setDwellingTypeLabel('x'.repeat(100));
    expect(component.draft().dwellingTypeLabel).toHaveSize(80);
    component.setDwellingTypeFromPicker('duplex');
    expect(component.draft().dwellingTypeLabel).toBeNull();
    component.setDwellingTypeFromPicker(null);

    component.renameFloor('F'.repeat(100));
    expect(component.activeFloor()?.name).toHaveSize(80);
    component.addFloor();
    component.addBasement();
    expect(component.draft().floors.map((floor) => floor.level)).toEqual([0, 1, -1]);
    component.selectFloor('missing-floor');
    expect(component.activeFloor()?.level).toBe(-1);
    expect(component.floorOptions()).toHaveSize(3);
    expect(component.dwellingTypeOptions()).toHaveSize(10);
    expect(component.areaOptions().length).toBeGreaterThan(45);
    expect(component.groupLabel('exterior')).toBe('Exterior y semiexterior');
    expect(component.selectedSpaceLabel()).toBe('');

    component.setSelectedKindFromPicker('unsupported-zone');
    component.setSelectedKindFromPicker('custom');
    component.addGuidedSpace();
    expect(component.errorKey()).toBe('household.plan_custom_label_required');
    component.selectedLabel.set('Zona de ensayo');
    component.addGuidedSpace();
    expect(component.activeFloor()?.spaces[0].label).toBe('Zona de ensayo');

    const maxedFloor = structuredClone(component.draft());
    maxedFloor.floors[maxedFloor.floors.length - 1].spaces = Array.from(
      { length: 80 },
      (_, index) => ({
        id: `space-${index}`,
        kind: 'kitchen' as const,
        label: 'Cocina',
        parentSpaceId: null,
        polygon: [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
          { x: 300, y: 300 },
          { x: 100, y: 300 }
        ]
      })
    );
    component.draft.set(maxedFloor);
    component.addGuidedSpace();
    expect(component.errorKey()).toBe('household.plan_area_limit');

    const maxFloors: HouseholdPlan = structuredClone(maxedFloor);
    maxFloors.floors = Array.from({ length: 12 }, (_, index) => ({
      id: `floor-${index}`,
      name: `Planta ${index}`,
      level: index,
      walls: [],
      openings: [],
      spaces: []
    }));
    component.draft.set(maxFloors);
    component.selectedFloorId.set('floor-11');
    component.addFloor();
    expect(component.errorKey()).toBe('household.plan_floor_limit');
  });

  it('reports load/save errors and maps every recoverable AI proposal error', async () => {
    await mount();
    planService.load.and.returnValue(throwError(() => new Error('offline')));
    component.loadPlan();
    expect(component.errorKey()).toBe('household.plan_load_error');

    planService.load.and.returnValue(of(emptySnapshot));
    component.loadPlan();
    component.addGuidedSpace();
    planService.save.and.returnValue(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { code: 'PLAN_VERSION_CONFLICT' } })
      )
    );
    component.savePlan();
    expect(component.errorKey()).toBe('household.plan_conflict');
    planService.save.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    component.savePlan();
    expect(component.errorKey()).toBe('household.plan_save_error');

    component.prompt.set('Describe el plano');
    const cases: Array<[number, unknown, string]> = [
      [409, {}, 'household.plan_conflict'],
      [400, { code: 'AI_CONFIGURATION_REQUIRED' }, 'household.plan_ai_config_required'],
      [504, { code: 'AI_PROVIDER_TIMEOUT' }, 'household.plan_ai_timeout'],
      [422, { code: 'AI_PROPOSAL_INVALID' }, 'household.plan_ai_invalid'],
      [499, { code: 'AI_REQUEST_CANCELLED' }, 'household.plan_ai_cancelled'],
      [403, { code: 'HOUSEHOLD_SETTINGS_REQUIRED' }, 'household.plan_read_only'],
      [500, {}, 'household.plan_ai_error']
    ];
    for (const [status, error, key] of cases) {
      planService.propose.and.returnValue(
        throwError(() => new HttpErrorResponse({ status, error }))
      );
      component.requestProposal();
      expect(component.errorKey())
        .withContext(`status ${status}`)
        .toBe(key as TranslationKey);
    }
  });

  it('handles photo limits, selected-space actions, discard and proposal state transitions', async () => {
    await mount();
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'oversized.png');
    Object.defineProperty(fileInput, 'files', { value: [oversized], configurable: true });
    component.onAttachmentChange({ target: fileInput } as unknown as Event);
    expect(component.attachment()).toBeNull();
    expect(component.errorKey()).toBe('household.plan_file_too_large');

    const small = new File(['synthetic'], 'sketch.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [small], configurable: true });
    component.onAttachmentChange({ target: fileInput } as unknown as Event);
    expect(component.attachment()).toBe(small);
    component.clearAttachment(fileInput);
    expect(component.attachment()).toBeNull();
    expect(fileInput.value).toBe('');
    component.onAttachmentChange({ target: { files: null } } as unknown as Event);
    expect(component.attachment()).toBeNull();

    component.setSelectedKind('kitchen');
    component.addGuidedSpace();
    const selected = component.selectedSpace()!;
    component.updateSelectedLabel('Cocina amplia');
    expect(component.selectedSpace()?.label).toBe('Cocina amplia');
    expect(component.selectedSpaceLabel()).toBe('Cocina');
    const selectedEvent = jasmine.createSpy('zoneTasksSelected');
    component.zoneTasksSelected.subscribe(selectedEvent);
    component.openTasksForSelectedSpace();
    expect(selectedEvent).toHaveBeenCalledOnceWith(selected.id);
    component.setPreviewMode('proposal');
    expect(component.previewMode()).toBe('current');

    component.discardChanges();
    expect(component.draft().floors[0].spaces).toHaveSize(0);
    expect(component.isDirty()).toBeFalse();
    component.undo();
    expect(component.undoStack()).toHaveSize(0);

    const plan = emptyHouseholdPlan('Planta baja');
    component.proposal.set({
      baseVersion: 0,
      current: null,
      draft: plan,
      proposal: plan,
      diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
      orphanedTaskIds: []
    });
    component.setPreviewMode('proposal');
    expect(component.previewMode()).toBe('proposal');
    component.discardProposal();
    expect(component.proposal()).toBeNull();
    expect(component.previewMode()).toBe('current');
  });
});
