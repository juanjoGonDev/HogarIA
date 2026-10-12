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
import type { HouseholdMember } from '../../shared/models/household.model';
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

  function fakeCanvas(
    width = 100,
    height = 100,
    viewBox = { x: 0, y: 0, width: 10_000, height: 10_000 }
  ): SVGSVGElement {
    return {
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
      viewBox: { baseVal: viewBox },
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
      'propose',
      'loadAssignments',
      'saveAssignment'
    ]);
    planService.load.and.returnValue(of(emptySnapshot));
    planService.save.and.returnValue(of(emptySnapshot));
    planService.propose.and.returnValue(throwError(() => new Error('unexpected proposal')));
    planService.loadAssignments.and.returnValue(
      of({ planVersion: 0, version: 0, assignments: {} })
    );
    planService.saveAssignment.and.returnValue(of({ planVersion: 0, version: 1, assignments: {} }));
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

  it('starts a starter layout as a local draft and never writes it without an explicit save', async () => {
    await mount();

    expect(component.setupVisible()).toBeTrue();
    component.selectEntryMethod('guided');
    component.setSetupFloorCount(1);
    component.startPlan();

    expect(component.setupVisible()).toBeFalse();
    expect(component.draft().floors[0].spaces).toHaveSize(7);
    expect(component.draft().floors[0].walls.length).toBeGreaterThan(0);
    expect(
      component.draft().floors[0].spaces.some((space) =>
        space.polygon.some((point, index) => {
          const next = space.polygon[(index + 1) % space.polygon.length];
          return point.x !== next.x && point.y !== next.y;
        })
      )
    )
      .withContext('the guided starter layout should demonstrate a non-rectangular room edge')
      .toBeTrue();
    expect(
      component
        .draft()
        .floors[0].walls.some((wall) => wall.from.x !== wall.to.x && wall.from.y !== wall.to.y)
    )
      .withContext('the guided starter layout should demonstrate an angled wall')
      .toBeTrue();
    expect(component.draft().floors[0].openings[0].isMainEntrance).toBeTrue();
    expect(
      component.draft().floors[0].openings.filter((opening) => opening.kind === 'door')
    ).toHaveSize(4);
    expect(
      component.draft().floors[0].openings.filter((opening) => opening.kind === 'window')
    ).toHaveSize(3);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.plan-canvas__door-leaf').length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.plan-canvas__door-swing').length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.plan-canvas__window-rail').length).toBe(6);
    expect(component.snapshot()).toEqual(emptySnapshot);
    expect(planService.save).not.toHaveBeenCalled();
    expect(component.isDirty()).toBeTrue();
  });

  it('hides the generic empty-plan prompt while freehand drawing instructions are active', async () => {
    await mount();
    component.selectEntryMethod('photo');
    component.startPlan();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.plan-canvas__empty')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="plan-canvas-empty"] svg')
    ).not.toBeNull();

    component.setTool('freeform');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.plan-canvas__empty')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="plan-freeform-actions"]')
    ).not.toBeNull();
  });

  it('uses a landscape starter floor proportioned for the plan canvas reference', async () => {
    await mount();
    component.selectEntryMethod('guided');
    component.startPlan();

    const floor = component.draft().floors[0];
    const xs = [
      ...floor.spaces.flatMap((space) => space.polygon.map((point) => point.x)),
      ...floor.walls.flatMap((wall) => [wall.from.x, wall.to.x])
    ];
    const ys = [
      ...floor.spaces.flatMap((space) => space.polygon.map((point) => point.y)),
      ...floor.walls.flatMap((wall) => [wall.from.y, wall.to.y])
    ];
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const [viewX, viewY, viewWidth, viewHeight] = component.canvasViewBox.split(' ').map(Number);

    expect(width / height).toBeGreaterThanOrEqual(1.25);
    expect(viewX).toBeLessThan(Math.min(...xs));
    expect(viewY).toBeLessThan(Math.min(...ys));
    expect(viewX + viewWidth).toBeGreaterThan(Math.max(...xs));
    expect(viewY + viewHeight).toBeGreaterThan(Math.max(...ys));
    expect(viewWidth / viewHeight).toBeCloseTo(1.25, 1);
  });

  it('places guided areas inside the existing footprint without covering another zone', async () => {
    await mount();
    component.selectEntryMethod('guided');
    component.startPlan();
    component.setSelectedKind('custom');
    component.selectedLabel.set('Sala de música');
    const originalSpaces = structuredClone(component.activeFloor()!.spaces);
    const allOriginalPoints = originalSpaces.flatMap((space) => space.polygon);

    component.addGuidedSpace();

    const inserted = component
      .activeFloor()!
      .spaces.find((space) => space.label === 'Sala de música');
    expect(inserted).toBeDefined();
    const insertedBounds = {
      minX: Math.min(...inserted!.polygon.map((point) => point.x)),
      maxX: Math.max(...inserted!.polygon.map((point) => point.x)),
      minY: Math.min(...inserted!.polygon.map((point) => point.y)),
      maxY: Math.max(...inserted!.polygon.map((point) => point.y))
    };
    expect(insertedBounds.minX).toBeGreaterThanOrEqual(
      Math.min(...allOriginalPoints.map((p) => p.x))
    );
    expect(insertedBounds.maxX).toBeLessThanOrEqual(Math.max(...allOriginalPoints.map((p) => p.x)));
    expect(insertedBounds.minY).toBeGreaterThanOrEqual(
      Math.min(...allOriginalPoints.map((p) => p.y))
    );
    expect(insertedBounds.maxY).toBeLessThanOrEqual(Math.max(...allOriginalPoints.map((p) => p.y)));
    expect(
      originalSpaces.every((space) => {
        const bounds = {
          minX: Math.min(...space.polygon.map((point) => point.x)),
          maxX: Math.max(...space.polygon.map((point) => point.x)),
          minY: Math.min(...space.polygon.map((point) => point.y)),
          maxY: Math.max(...space.polygon.map((point) => point.y))
        };
        return (
          insertedBounds.maxX <= bounds.minX ||
          insertedBounds.minX >= bounds.maxX ||
          insertedBounds.maxY <= bounds.minY ||
          insertedBounds.minY >= bounds.maxY
        );
      })
    ).toBeTrue();
  });

  it('does not add a guided zone when the floor has no useful free rectangle', async () => {
    await mount();
    const fullFloor = structuredClone(component.draft());
    fullFloor.floors[0].spaces = [
      {
        id: 'occupied-floor',
        kind: 'custom',
        label: 'Zona completa',
        parentSpaceId: null,
        polygon: [
          { x: 0, y: 0 },
          { x: 10_000, y: 0 },
          { x: 10_000, y: 10_000 },
          { x: 0, y: 10_000 }
        ]
      }
    ];
    component.draft.set(fullFloor);
    component.setSelectedKind('kitchen');

    component.addGuidedSpace();

    expect(component.draft()).toEqual(fullFloor);
    expect(String(component.errorKey())).toBe('household.plan_no_guided_space');
  });

  it('wraps long zone labels and scales their icon to compact areas', async () => {
    await mount();
    const compactSpace = {
      ...component.draft().floors[0].spaces[0],
      label: 'Sala de música',
      polygon: [
        { x: 3_000, y: 4_400 },
        { x: 4_300, y: 4_400 },
        { x: 4_300, y: 5_600 },
        { x: 3_000, y: 5_600 }
      ]
    };

    expect(component.spaceLabelLines(compactSpace)).toEqual(['Sala de', 'música']);
    expect(component.spaceLabelFontSize(compactSpace)).toBeLessThan(290);
    expect(component.spaceGlyphSize(compactSpace)).toBeLessThan(800);
    expect(component.spaceLabelTop(compactSpace)).toBeGreaterThan(
      component.spaceGlyphTop(compactSpace)
    );
    expect(
      component.spaceLabelLines({ ...compactSpace, label: 'Sala superextraordinariamente' })[0]
    ).toBe('Sala');
    expect(
      component.spaceLabelLines({ ...compactSpace, label: 'superextraordinariamente' })
    ).toEqual(['superext', 'raordina', 'riamente']);
    const longLabelLines = component.spaceLabelLines({
      ...compactSpace,
      label: 'superextraordinariamenteextraordinariamente'
    });
    expect(longLabelLines).toHaveSize(3);
    expect(longLabelLines[2].endsWith('…')).toBeTrue();
    expect(component.spaceLabelLines({ ...compactSpace, label: '   ' })).toEqual(['']);
  });

  it('keeps assignment markers below labels and within narrow room bounds', async () => {
    await mount();
    component.selectEntryMethod('guided');
    component.startPlan();
    const kitchen = component.draft().floors[0].spaces.find((space) => space.kind === 'kitchen');
    expect(kitchen).toBeDefined();
    if (!kitchen) return;

    component.assignmentSnapshot.set({
      planVersion: 0,
      version: 1,
      assignments: { [kitchen.id]: ['member-a', 'member-b', 'member-c'] }
    });
    component.selectSpace(kitchen);

    const labelBottom =
      component.spaceLabelTop(kitchen) +
      (component.spaceLabelLines(kitchen).length - 1) * component.spaceLabelFontSize(kitchen) +
      component.spaceLabelFontSize(kitchen) / 2;
    const markerTop =
      component.assignmentMemberY(kitchen) - component.assignmentMemberRadius(kitchen);
    expect(markerTop - labelBottom).toBeGreaterThanOrEqual(60);
    expect(component.assignmentMemberRadius(kitchen)).toBe(210);

    const narrowSpace = {
      ...kitchen,
      polygon: [
        { x: 300, y: 4_000 },
        { x: 1_100, y: 4_000 },
        { x: 1_100, y: 5_000 },
        { x: 300, y: 5_000 }
      ]
    };
    const radius = component.assignmentMemberRadius(narrowSpace);
    expect(radius).toBeLessThan(component.assignmentMemberRadius(kitchen));
    expect(component.assignmentMemberX(narrowSpace, 0) - radius).toBeGreaterThanOrEqual(350);
    expect(component.assignmentMemberX(narrowSpace, 2) + radius).toBeLessThanOrEqual(1_050);

    const bathroom = component.draft().floors[0].spaces.find((space) => space.kind === 'bathroom');
    expect(bathroom).toBeDefined();
    if (!bathroom) return;
    component.assignmentSnapshot.update((snapshot) => ({
      ...snapshot,
      assignments: { ...snapshot.assignments, [bathroom.id]: ['member-a'] }
    }));
    component.selectSpace(bathroom);
    const bathroomMinY = Math.min(...bathroom.polygon.map((point) => point.y));
    const bathroomLabelBottom =
      component.spaceLabelTop(bathroom) +
      (component.spaceLabelLines(bathroom).length - 1) * component.spaceLabelFontSize(bathroom) +
      component.spaceLabelFontSize(bathroom) / 2;
    const bathroomMarkerTop =
      component.assignmentMemberY(bathroom) - component.assignmentMemberRadius(bathroom);
    expect(component.spaceGlyphTop(bathroom)).toBeGreaterThanOrEqual(bathroomMinY + 60);
    expect(bathroomMarkerTop - bathroomLabelBottom).toBeGreaterThanOrEqual(60);
  });

  it('uses the illustrated method and dwelling icons from the plan setup design', async () => {
    await mount();
    const nativeElement = fixture.nativeElement as HTMLElement;

    const dwellingIcons = nativeElement.querySelectorAll<SVGSVGElement>(
      '.plan-setup__dwelling-icon svg'
    );
    const methodIcons = nativeElement.querySelectorAll<SVGSVGElement>(
      '.plan-method-card__icon svg'
    );

    expect(dwellingIcons.length).toBe(4);
    expect(methodIcons.length).toBe(3);
    expect(
      Array.from(methodIcons).every(
        (icon) => icon.parentElement?.getAttribute('aria-hidden') === 'true'
      )
    ).toBeTrue();
    expect(component.dwellingCardLabel('apartment')).toBe(
      'household.plan_dwelling_short_apartment'
    );
  });

  it('colors assigned, shared, and unassigned zones consistently and closes zone details', async () => {
    await mount();
    component.selectEntryMethod('guided');
    component.startPlan();
    component.members = [
      { userId: 'member-a', name: 'Ana', isActive: true } as HouseholdMember,
      { userId: 'member-b', name: 'Bea', isActive: true } as HouseholdMember
    ];
    component.assignmentSnapshot.set({
      planVersion: 0,
      version: 1,
      assignments: {
        kitchen: ['member-a'],
        living: ['member-a', 'member-b'],
        bath: ['member-b']
      }
    });

    expect(component.memberIndexForId('member-a')).toBe(0);
    expect(component.spaceResponsibilityClass('kitchen')).toBe('plan-canvas__space--member-0');
    expect(component.spaceResponsibilityClass('bath')).toBe('plan-canvas__space--member-1');
    expect(component.spaceResponsibilityClass('living')).toBe('plan-canvas__space--shared');
    expect(component.spaceResponsibilityClass('unassigned')).toBe('');

    component.selectSpace(component.draft().floors[0].spaces[0]);
    expect(component.selectedSpace()).not.toBeNull();
    expect(component.assignmentViewActive()).toBeTrue();
    component.closeSpaceDetails();
    expect(component.selectedSpace()).toBeNull();
    expect(component.assignmentViewActive()).toBeFalse();
    expect(component.assignmentDraftMemberIds()).toEqual([]);
  });

  it('marks a zone shared only when every active household member is assigned', async () => {
    await mount();
    component.members = [
      { userId: 'member-a', name: 'Ana', isActive: true } as HouseholdMember,
      { userId: 'member-b', name: 'Bea', isActive: true } as HouseholdMember,
      { userId: 'member-c', name: 'Cris', isActive: true } as HouseholdMember
    ];

    component.assignmentDraftMemberIds.set(['member-a', 'member-b', 'member-c']);
    expect(component.assignmentDraftIsShared()).toBeTrue();

    component.assignmentDraftMemberIds.set(['member-a', 'member-b']);
    expect(component.assignmentDraftIsShared()).toBeFalse();

    component.assignmentDraftMemberIds.set(['inactive-member', 'member-a', 'member-b', 'member-c']);
    expect(component.assignmentDraftIsShared()).toBeFalse();

    component.assignmentDraftMemberIds.set(['member-a', 'member-b', 'member-c']);
    component.toggleAssignmentMember('member-a');
    expect(component.assignmentDraftMemberIds()).toEqual(['member-a']);
    expect(component.assignmentDraftIsShared()).toBeFalse();
  });

  it('notifies the household task view after a zone assignment is persisted', async () => {
    await mount();
    component.selectEntryMethod('guided');
    component.startPlan();
    component.members = [{ userId: 'member-a', name: 'Ana', isActive: true } as HouseholdMember];
    const space = component.draft().floors[0].spaces[0];
    component.selectSpace(space);
    component.toggleAssignmentMember('member-a');
    const assignment = {
      planVersion: component.snapshot().version,
      version: 1,
      assignments: { [space.id]: ['member-a'] }
    };
    planService.saveAssignment.and.returnValue(of(assignment));
    const assignmentSaved = jasmine.createSpy('assignmentSaved');
    component.assignmentSaved.subscribe(assignmentSaved);
    const assignmentVersion = component.assignmentSnapshot().version;

    component.saveZoneAssignment();

    expect(planService.saveAssignment).toHaveBeenCalledOnceWith(
      'synthetic-home',
      assignmentVersion,
      component.snapshot().version,
      space.id,
      ['member-a']
    );
    expect(assignmentSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps edits local, supports undo and only persists after an explicit save', async () => {
    await mount();
    planService.save.and.callFake((_householdId, _version, plan) => of({ version: 1, plan }));

    component.addGuidedSpace();
    expect(component.draft().floors[0].spaces).toHaveSize(1);
    expect(component.snapshot()).toEqual(emptySnapshot);

    component.undo();
    expect(component.draft().floors[0].spaces).toHaveSize(0);
    component.redo();
    expect(component.draft().floors[0].spaces).toHaveSize(1);
    component.undo();
    component.selectedKind.set('kitchen');
    component.addGuidedSpace();
    const replacement = structuredClone(component.draft());
    component.redo();
    expect(component.draft()).toEqual(replacement);
    const editedPlan = structuredClone(component.draft());
    component.savePlan();

    expect(planService.save).toHaveBeenCalledOnceWith('synthetic-home', 0, editedPlan, []);
    expect(editedPlan.floors[0].spaces[0].label).toBe('Cocina');
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
      'propose',
      'loadAssignments',
      'saveAssignment'
    ]);
    planService.load.and.returnValues(first, second);
    planService.save.and.returnValue(of(emptySnapshot));
    planService.propose.and.returnValue(throwError(() => new Error('unused')));
    planService.loadAssignments.and.returnValue(
      of({ planVersion: 0, version: 0, assignments: {} })
    );
    planService.saveAssignment.and.returnValue(of({ planVersion: 0, version: 1, assignments: {} }));
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
    expect(component.drawingRect()).toEqual({ x: 1000, y: 1000, width: 5000, height: 4600 });
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
    expect(component.draft().floors[0].spaces[1].polygon[0]).toEqual({ x: 1600, y: 1600 });
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

  it('maps pointer positions through the cropped plan viewBox without shifting model coordinates', async () => {
    await mount();
    const canvas = fakeCanvas(100, 100, { x: 500, y: 500, width: 9_000, height: 9_000 });
    const emptyTarget = document.createElement('div');
    component.snapToGrid.set(false);
    component.setSelectedKindFromPicker('kitchen');
    component.setTool('space');

    component.onCanvasPointerDown(pointer(canvas, emptyTarget, 10, 20));
    component.onCanvasPointerMove(pointer(canvas, emptyTarget, 60, 70));

    expect(component.drawingRect()).toEqual({ x: 1_400, y: 2_300, width: 4_500, height: 4_500 });
  });

  it('draws a custom concave area with freeform taps and cancels an invalid crossing polygon', async () => {
    await mount();
    const canvas = fakeCanvas();
    const target = document.createElement('div');
    component.setSelectedKindFromPicker('custom');
    component.selectedLabel.set('Trastero con rincón');
    component.setTool('freeform');

    for (const [x, y] of [
      [10, 10],
      [90, 10],
      [90, 40],
      [50, 40],
      [50, 90],
      [10, 90]
    ]) {
      const event = pointer(canvas, target, x, y);
      component.onCanvasPointerDown(event);
      component.onCanvasPointerUp(event);
    }
    expect(component.freeformPoints()).toHaveSize(6);
    component.finishFreeformSpace();
    const created = component.draft().floors[0].spaces[0];
    expect(created.label).toBe('Trastero con rincón');
    expect(created.polygon).toHaveSize(6);
    expect(created.polygon[2]).toEqual({ x: 9_000, y: 4_000 });
    expect(component.tool()).toBe('select');
    expect(component.assignmentViewActive()).toBeFalse();

    component.setSelectedKindFromPicker('kitchen');
    component.setTool('freeform');
    for (const [x, y] of [
      [10, 10],
      [90, 90],
      [10, 90],
      [90, 10]
    ]) {
      const event = pointer(canvas, target, x, y);
      component.onCanvasPointerDown(event);
      component.onCanvasPointerUp(event);
    }
    component.finishFreeformSpace();
    expect(component.errorKey()).toBe('household.plan_polygon_invalid');
    expect(component.draft().floors[0].spaces).toHaveSize(1);
    component.cancelFreeformDrawing();
    expect(component.freeformPoints()).toEqual([]);
    expect(component.tool()).toBe('select');
  });

  it('does not switch to area assignment when a freeform tap lands on an existing space', async () => {
    await mount();
    component.selectEntryMethod('guided');
    component.startPlan();
    component.setSelectedKindFromPicker('kitchen');
    component.addGuidedSpace();
    fixture.detectChanges();
    component.setTool('freeform');
    fixture.detectChanges();

    const spaceId = component.draft().floors[0].spaces[0].id;
    const polygon = fixture.nativeElement.querySelector(
      `[data-space-id="${spaceId}"]`
    ) as SVGPolygonElement;
    polygon.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(component.tool()).toBe('freeform');
    expect(component.assignmentViewActive()).toBeFalse();
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

  it('falls back safely when the selected floor or every floor is missing', async () => {
    await mount();
    const firstFloorId = component.draft().floors[0].id;
    component.selectedFloorId.set('stale-floor');

    expect(component.activeFloor()).toBeNull();
    expect(component.shownFloor()?.id).toBe(firstFloorId);

    const planWithoutFloors = structuredClone(component.draft());
    planWithoutFloors.floors = [];
    component.draft.set(planWithoutFloors);
    expect(component.shownFloor()).toBeNull();
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

  it('keeps an AI proposal as an unsaved draft when continuing to request another change', async () => {
    await mount();
    component.setSelectedKind('kitchen');
    component.addGuidedSpace();
    const startingDraft = structuredClone(component.draft());
    const proposedPlan = structuredClone(startingDraft);
    proposedPlan.floors[0].spaces[0].label = 'Cocina con isla';
    const file = new File(['synthetic'], 'sketch.png', { type: 'image/png' });
    component.attachment.set(file);
    component.prompt.set('Primer cambio');
    component.proposal.set({
      baseVersion: component.snapshot().version,
      current: component.snapshot().plan,
      draft: startingDraft,
      proposal: proposedPlan,
      diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
      orphanedTaskIds: ['orphaned-task']
    });
    component.previewMode.set('proposal');

    component.continueEditingProposal();

    expect(component.proposal()).toBeNull();
    expect(component.draft()).toEqual(proposedPlan);
    expect(component.snapshot().version).toBe(0);
    expect(component.isDirty()).toBeTrue();
    expect(component.previewMode()).toBe('current');
    expect(component.prompt()).toBe('');
    expect(component.attachment()).toBeNull();
    expect(component.orphanedTaskIds()).toEqual(['orphaned-task']);
    component.undo();
    expect(component.draft()).toEqual(startingDraft);
  });

  it('starts a photo follow-up from the proposal without persisting the proposed plan', async () => {
    await mount();
    component.setSelectedKind('kitchen');
    component.addGuidedSpace();
    const startingDraft = structuredClone(component.draft());
    const proposedPlan = structuredClone(startingDraft);
    proposedPlan.floors[0].spaces[0].label = 'Cocina con isla';
    component.proposal.set({
      baseVersion: component.snapshot().version,
      current: component.snapshot().plan,
      draft: startingDraft,
      proposal: proposedPlan,
      diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
      orphanedTaskIds: ['orphaned-task']
    });
    component.previewMode.set('proposal');
    const file = new File(['synthetic-photo'], 'follow-up.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });

    component.startPhotoFollowup({ target: input } as unknown as Event);

    expect(component.proposal()).toBeNull();
    expect(component.draft()).toEqual(proposedPlan);
    expect(component.snapshot().version).toBe(0);
    expect(component.isDirty()).toBeTrue();
    expect(component.attachment()).toBe(file);
    expect(component.prompt()).toBe('');
    expect(component.orphanedTaskIds()).toEqual(['orphaned-task']);
    expect(component.confirmOrphanedTasks()).toBeFalse();
    expect(planService.propose).not.toHaveBeenCalled();
    expect(planService.save).not.toHaveBeenCalled();
  });

  it('keeps the current proposal when a photo follow-up exceeds the upload limit', async () => {
    await mount();
    const plan = structuredClone(component.draft());
    component.proposal.set({
      baseVersion: 0,
      current: null,
      draft: plan,
      proposal: plan,
      diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
      orphanedTaskIds: []
    });
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.png')],
      configurable: true
    });

    component.startPhotoFollowup({ target: input } as unknown as Event);

    expect(component.proposal()).not.toBeNull();
    expect(component.draft()).toEqual(plan);
    expect(component.errorKey()).toBe('household.plan_file_too_large');
    expect(input.value).toBe('');
    expect(component.attachment()).toBeNull();
    expect(planService.propose).not.toHaveBeenCalled();
    expect(planService.save).not.toHaveBeenCalled();
  });
});
