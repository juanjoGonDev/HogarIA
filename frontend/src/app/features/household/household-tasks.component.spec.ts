import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { HouseholdPlanService } from '../../core/services/household-plan.service';
import { HouseholdTasksService } from '../../core/services/household-tasks.service';
import type { HouseholdMember } from '../../shared/models/household.model';
import type {
  HouseholdPlan,
  HouseholdPlanFloor,
  HouseholdPlanOpening
} from '../../shared/models/household-plan.model';
import type {
  HouseholdTaskOccurrence,
  VersionedHouseholdTaskWeek
} from '../../shared/models/household-task.model';
import { getMondayIsoDate, HouseholdTasksComponent } from './household-tasks.component';

describe('HouseholdTasksComponent', () => {
  let fixture: ComponentFixture<HouseholdTasksComponent>;
  let component: HouseholdTasksComponent;
  let tasksService: jasmine.SpyObj<HouseholdTasksService>;
  let planService: jasmine.SpyObj<HouseholdPlanService>;
  let assignmentResponse = {
    planVersion: 0,
    version: 0,
    assignments: {} as Record<string, string[]>
  };

  const members: HouseholdMember[] = [
    {
      id: 'membership-ada',
      userId: 'ada',
      name: 'Ada',
      email: 'ada@example.test',
      role: 'member',
      cookingLevel: 'beginner',
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true
    },
    {
      id: 'membership-lin',
      userId: 'lin',
      name: 'Lin',
      email: 'lin@example.test',
      role: 'child',
      cookingLevel: 'beginner',
      joinedAt: new Date('2026-01-02T00:00:00.000Z'),
      isActive: true
    }
  ];
  const plan: HouseholdPlan = {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: '',
    warnings: [],
    floors: [
      {
        id: 'floor-0',
        name: 'Planta baja',
        level: 0,
        walls: [],
        openings: [],
        spaces: [
          {
            id: 'kitchen',
            kind: 'kitchen',
            label: 'Cocina',
            parentSpaceId: null,
            polygon: [
              { x: 100, y: 100 },
              { x: 900, y: 100 },
              { x: 900, y: 900 },
              { x: 100, y: 900 }
            ]
          }
        ]
      }
    ]
  };
  const i18n = {
    resolved: signal<'es' | 'en'>('es'),
    changeTick: signal(0),
    t: (key: string) => key
  };

  async function mount(canEdit = true): Promise<void> {
    tasksService = jasmine.createSpyObj<HouseholdTasksService>('HouseholdTasksService', [
      'load',
      'save'
    ]);
    tasksService.load.and.callFake((_householdId, weekStart) =>
      of({ weekStart, version: 0, tasks: [] })
    );
    tasksService.save.and.callFake((_householdId, weekStart, baseVersion, tasks) =>
      of({ weekStart, version: baseVersion + 1, tasks })
    );
    planService = jasmine.createSpyObj<HouseholdPlanService>('HouseholdPlanService', [
      'load',
      'loadAssignments'
    ]);
    planService.load.and.returnValue(of({ version: 0, plan }));
    planService.loadAssignments.and.returnValue(of(assignmentResponse));

    await TestBed.configureTestingModule({
      imports: [HouseholdTasksComponent],
      providers: [
        { provide: HouseholdTasksService, useValue: tasksService },
        { provide: HouseholdPlanService, useValue: planService },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdTasksComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'synthetic-home');
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('members', members);
    fixture.detectChanges();
  }

  beforeEach(() => {
    assignmentResponse = { planVersion: 0, version: 0, assignments: {} };
    TestBed.resetTestingModule();
  });

  it('frames the task map around the active floor geometry with safe padding', async () => {
    await mount();
    const viewBox = component.planViewBox().split(' ').map(Number);
    const canvas = fixture.nativeElement.querySelector(
      '[data-test="tasks-plan-canvas"]'
    ) as SVGSVGElement;

    expect(viewBox).toEqual([-150, -150, 1300, 1300]);
    expect(canvas.getAttribute('viewBox')).toBe(component.planViewBox());
    component.plan.set(null);
    expect(component.planViewBox()).toBe('0 0 10000 10000');
  });

  it('keeps a wide floor plan large in the mobile map while retaining a safety margin', async () => {
    await mount();
    const floor = plan.floors[0];
    component.plan.set({
      ...plan,
      floors: [
        {
          ...floor,
          spaces: [
            {
              ...floor.spaces[0],
              polygon: [
                { x: 100, y: 100 },
                { x: 9_900, y: 100 },
                { x: 9_900, y: 900 },
                { x: 100, y: 900 }
              ]
            }
          ]
        }
      ]
    });

    expect(component.planViewBox().split(' ').map(Number)).toEqual([-439, -439, 10_878, 1_878]);
  });

  it('adds and edits a household-week task locally and saves it with the versioned API', async () => {
    await mount();
    component.newTitle.set('Barrer cocina');
    component.newSpaceId.set('kitchen');
    component.newMemberId.set('ada');
    component.addTask();

    expect(component.draftTasks()).toHaveSize(1);
    expect(component.draftTasks()[0]).toEqual(
      jasmine.objectContaining({
        title: 'Barrer cocina',
        spaceId: 'kitchen',
        assignedMemberId: 'ada',
        completed: false
      })
    );
    expect(tasksService.save).not.toHaveBeenCalled();

    component.updateTask(component.draftTasks()[0].id, { completed: true });
    const savedTasks = structuredClone(component.draftTasks());
    component.saveWeek();

    expect(tasksService.save).toHaveBeenCalledOnceWith(
      'synthetic-home',
      component.weekStart(),
      0,
      savedTasks
    );
    expect(component.snapshot()).toEqual({
      weekStart: component.weekStart(),
      version: 1,
      tasks: savedTasks
    });
    expect(component.isDirty()).toBeFalse();
  });

  it('renders door swing arcs and double window rails from each opening wall', async () => {
    await mount();
    const floor: HouseholdPlanFloor = {
      ...plan.floors[0],
      walls: [
        {
          id: 'horizontal-wall',
          kind: 'exterior',
          from: { x: 1_000, y: 1_000 },
          to: { x: 9_000, y: 1_000 }
        },
        {
          id: 'vertical-wall',
          kind: 'exterior',
          from: { x: 9_000, y: 1_000 },
          to: { x: 9_000, y: 9_000 }
        }
      ]
    };
    const door: HouseholdPlanOpening = {
      id: 'front-door',
      wallId: 'horizontal-wall',
      kind: 'door',
      offset: 2_000,
      width: 900,
      isMainEntrance: true
    };
    const window: HouseholdPlanOpening = {
      id: 'side-window',
      wallId: 'vertical-wall',
      kind: 'window',
      offset: 2_000,
      width: 1_200,
      isMainEntrance: false
    };

    expect(component.doorSwing(floor, door)).toEqual({
      hinge: { x: 3_900, y: 1_000 },
      leafTip: { x: 3_900, y: 100 },
      arc: 'M 3900 100 A 900 900 0 0 0 3000 1000'
    });
    expect(component.openingRails(floor, window)).toEqual([
      { from: { x: 8_930, y: 3_000 }, to: { x: 8_930, y: 4_200 } },
      { from: { x: 9_070, y: 3_000 }, to: { x: 9_070, y: 4_200 } }
    ]);
    expect(component.openingRails(floor, door)).toEqual([]);
  });

  it('filters by a selected plan zone while keeping the full schedule unchanged', async () => {
    await mount();
    const date = component.weekStart();
    const homeTask: HouseholdTaskOccurrence = {
      id: 'whole-home',
      title: 'Sacar la basura',
      details: null,
      spaceId: null,
      scheduledDate: date,
      assignedMemberId: null,
      completed: false
    };
    const kitchenTask = { ...homeTask, id: 'kitchen-task', title: 'Fregar', spaceId: 'kitchen' };
    component.draftTasks.set([homeTask, kitchenTask]);
    component.filterSpaceId.set('kitchen');

    expect(component.visibleTasks()).toEqual([kitchenTask]);
    expect(component.draftTasks()).toHaveSize(2);
  });

  it('loads version-matched zone responsibility for the interactive task map', async () => {
    assignmentResponse = { planVersion: 0, version: 3, assignments: { kitchen: ['ada', 'lin'] } };
    await mount();

    expect(component.activeFloor()?.id).toBe('floor-0');
    expect(component.mapSpaces().map((space) => space.id)).toEqual(['kitchen']);
    expect(component.assignmentClass('kitchen')).toBe('tasks-map__area--shared');
    expect(component.spaceAssignmentLabel('kitchen')).toBe('household.plan_zone_shared');

    component.selectMapSpace('kitchen');
    expect(component.activeSpaceId()).toBe('kitchen');
    expect(component.filterSpaceId()).toBe('kitchen');
    expect(component.newSpaceId()).toBe('kitchen');
  });

  it('ignores zone responsibility tied to an obsolete plan version', async () => {
    assignmentResponse = { planVersion: 9, version: 4, assignments: { kitchen: ['ada'] } };
    await mount();

    expect(component.assignments()).toEqual({});
    expect(component.assignmentClass('kitchen')).toBe('tasks-map__area--unassigned');
  });

  it('previews a fair, non-consecutive assignment and only applies it to the draft after confirmation', async () => {
    await mount();
    const dates = component
      .weekDays()
      .slice(0, 4)
      .map((day) => day.date);
    const tasks = dates.map((date, index) => ({
      id: `task-${index}`,
      title: `Task ${index}`,
      details: null,
      spaceId: null,
      scheduledDate: date,
      assignedMemberId: null,
      completed: false
    }));
    component.draftTasks.set(tasks);

    component.createRandomPreview();

    expect(component.randomPreview()).not.toBeNull();
    expect(component.draftTasks()).toEqual(tasks);
    const preview = component.randomPreview()!;
    for (let index = 1; index < preview.length; index += 1) {
      expect(preview[index].assignedMemberId).not.toBe(preview[index - 1].assignedMemberId);
    }
    component.applyRandomPreview();
    expect(component.draftTasks()).toEqual(preview);
    expect(tasksService.save).not.toHaveBeenCalled();
  });

  it('explains infeasible distribution and prevents read-only users from changing tasks', async () => {
    await mount();
    const date = component.weekStart();
    component.draftTasks.set([
      {
        id: 'one',
        title: 'One',
        details: null,
        spaceId: null,
        scheduledDate: date,
        assignedMemberId: null,
        completed: false
      },
      {
        id: 'two',
        title: 'Two',
        details: null,
        spaceId: null,
        scheduledDate: component.weekDays()[1].date,
        assignedMemberId: null,
        completed: false
      }
    ]);
    component.members = [members[0]];
    component.createRandomPreview();
    expect(component.errorKey()).toBe('household.tasks_distribution_impossible');
    expect(component.randomPreview()).toBeNull();

    fixture.destroy();
    await TestBed.resetTestingModule();
    await mount(false);
    const before = structuredClone(component.draftTasks());
    component.newTitle.set('No autorizado');
    component.addTask();
    expect(component.draftTasks()).toEqual(before);
    component.saveWeek();
    expect(tasksService.save).not.toHaveBeenCalled();
  });

  it('ignores task-week responses from a previous household', async () => {
    const first = new Subject<VersionedHouseholdTaskWeek>();
    const second = new Subject<VersionedHouseholdTaskWeek>();
    tasksService = jasmine.createSpyObj<HouseholdTasksService>('HouseholdTasksService', [
      'load',
      'save'
    ]);
    tasksService.load.and.returnValues(first, second);
    tasksService.save.and.returnValue(of({ weekStart: '2026-10-05', version: 1, tasks: [] }));
    planService = jasmine.createSpyObj<HouseholdPlanService>('HouseholdPlanService', [
      'load',
      'loadAssignments'
    ]);
    planService.load.and.returnValue(of({ version: 0, plan: null }));
    planService.loadAssignments.and.returnValue(
      of({ planVersion: 0, version: 0, assignments: {} })
    );
    await TestBed.configureTestingModule({
      imports: [HouseholdTasksComponent],
      providers: [
        { provide: HouseholdTasksService, useValue: tasksService },
        { provide: HouseholdPlanService, useValue: planService },
        { provide: I18nService, useValue: i18n }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HouseholdTasksComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'home-one');
    fixture.detectChanges();
    fixture.componentRef.setInput('householdId', 'home-two');
    fixture.detectChanges();
    first.next({ weekStart: component.weekStart(), version: 9, tasks: [] });
    second.next({ weekStart: component.weekStart(), version: 0, tasks: [] });

    expect(component.snapshot()).toEqual({
      weekStart: component.weekStart(),
      version: 0,
      tasks: []
    });
  });

  it('normalizes task fields, week changes, missing references, and member labels', async () => {
    await mount();
    expect(getMondayIsoDate(new Date(2026, 9, 11))).toBe('2026-10-05');
    expect(getMondayIsoDate(new Date(2026, 9, 12))).toBe('2026-10-12');

    component.newTitle.set('  Limpiar  ');
    component.newDetails.set('   ');
    component.newSpaceId.set('');
    component.newMemberId.set('');
    component.newDate.set(component.weekDays()[0].date);
    component.addTask();
    const created = component.draftTasks()[0];
    expect(created).toEqual(
      jasmine.objectContaining({
        title: 'Limpiar',
        details: null,
        spaceId: null,
        assignedMemberId: null
      })
    );
    component.updateTask('unknown-task', { title: 'no-op' });
    expect(component.draftTasks()[0].title).toBe('Limpiar');
    expect(component.tasksForDay(created.scheduledDate)).toEqual([created]);
    expect(component.memberName(null)).toBe('household.tasks_unassigned');
    expect(component.memberName('missing-member')).toBe('household.tasks_member_unavailable');

    component.members = [
      ...members,
      {
        ...members[0],
        id: 'inactive-membership',
        userId: 'inactive',
        name: 'Inactiva',
        isActive: false
      }
    ];
    expect(component.memberName('inactive')).toBe('Inactiva · household.tasks_inactive_member');
    expect(component.isInactiveMember(null)).toBeFalse();
    expect(component.isInactiveMember('inactive')).toBeTrue();
    expect(component.isInactiveMember('ada')).toBeFalse();
    expect(component.areaName(null)).toBe('household.tasks_whole_home');
    expect(component.areaName('removed')).toBe('household.tasks_area_removed');
    expect(component.hasSpace(null)).toBeFalse();
    expect(component.hasSpace('kitchen')).toBeTrue();
    expect(component.spaceOptions('removed').at(-1)).toEqual(
      jasmine.objectContaining({
        value: 'removed',
        disabled: true
      })
    );
    expect(component.memberOptions('removed-member').at(-1)).toEqual(
      jasmine.objectContaining({
        value: 'removed-member',
        disabled: true
      })
    );
    expect(component.dayOptions('2026-09-30').at(-1)).toEqual(
      jasmine.objectContaining({
        value: '2026-09-30',
        disabled: true
      })
    );
    expect(component.areaFilterOptions()[0].value).toBe('');

    component.weekStart.set('2026-10-05');
    component.shiftWeek(-1);
    expect(component.weekStart()).toBe('2026-09-28');
    expect(component.newDate()).toBe('2026-09-28');
    component.draftTasks.set([]);
    component.discardChanges();
    component.draftTasks.set([created]);
    component.deleteTask(created.id);
    expect(component.draftTasks()).toEqual([]);
  });

  it('handles loading failures, refresh inputs, and stale plan responses safely', async () => {
    await mount();
    tasksService.load.and.returnValue(throwError(() => new Error('offline')));
    component.loadWeek();
    expect(component.errorKey()).toBe('household.tasks_load_error');

    planService.load.and.returnValue(throwError(() => new Error('plan unavailable')));
    component.reload();
    expect(component.spaces()).toEqual([]);
    expect(component.loadingSpaces()).toBeFalse();

    planService.load.and.returnValue(of({ version: 1, plan }));
    component.reload();
    fixture.componentRef.setInput('selectedSpaceId', 'kitchen');
    fixture.detectChanges();
    expect(component.filterSpaceId()).toBe('kitchen');
    expect(component.newSpaceId()).toBe('kitchen');

    fixture.componentRef.setInput('refreshToken', 0);
    fixture.detectChanges();
    const loadCount = tasksService.load.calls.count();
    fixture.componentRef.setInput('refreshToken', 1);
    fixture.detectChanges();
    expect(tasksService.load.calls.count()).toBe(loadCount + 1);
    fixture.componentRef.setInput('selectedSpaceId', 'missing');
    fixture.detectChanges();
    expect(component.filterSpaceId()).toBe('missing');
    expect(component.newSpaceId()).toBe('kitchen');
  });

  it('maps save errors, guards duplicate writes, and previews empty or unassignable weeks', async () => {
    await mount();
    component.createRandomPreview();
    expect(component.randomPreview()).toBeNull();
    component.newTitle.set('Tarea sin miembros');
    component.addTask();
    component.members = [];
    component.createRandomPreview();
    expect(component.errorKey()).toBe('household.tasks_no_active_members');
    component.applyRandomPreview();
    component.discardRandomPreview();

    component.members = members;
    component.updateTask(component.draftTasks()[0].id, { title: 'Editada' });
    const cases: Array<[number, unknown, string]> = [
      [409, {}, 'household.tasks_conflict'],
      [422, { code: 'TASK_MEMBER_NOT_ACTIVE' }, 'household.tasks_member_unavailable'],
      [422, { code: 'TASK_SPACE_NOT_FOUND' }, 'household.tasks_space_unavailable'],
      [500, {}, 'household.tasks_save_error']
    ];
    for (const [status, error, key] of cases) {
      tasksService.save.and.returnValue(throwError(() => new HttpErrorResponse({ status, error })));
      component.saveWeek();
      expect(component.errorKey())
        .withContext(`status ${status}`)
        .toBe(key as never);
    }

    component.saving.set(true);
    component.saveWeek();
    expect(tasksService.save).toHaveBeenCalledTimes(cases.length);
    component.saving.set(false);
    component.randomPreview.set(structuredClone(component.draftTasks()));
    component.saveWeek();
    expect(tasksService.save).toHaveBeenCalledTimes(cases.length);
    expect(component.randomPreviewDiffers()).toBeFalse();
    component.discardChanges();
    expect(component.randomPreview()).toBeNull();
  });

  it('renders the weekly editor, status messages, and a reviewed random assignment', async () => {
    await mount();
    const task: HouseholdTaskOccurrence = {
      id: 'preview-task',
      title: 'Revisar zona quitada',
      details: null,
      spaceId: 'removed-space',
      scheduledDate: component.weekStart(),
      assignedMemberId: 'missing-member',
      completed: true
    };
    component.draftTasks.set([task]);
    component.randomPreview.set([{ ...task, assignedMemberId: 'ada' }]);
    component.errorKey.set('household.tasks_conflict');
    component.noticeKey.set('household.tasks_saved');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-test="tasks-random-preview"]')
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.task-card--completed')).not.toBeNull();
    expect(component.memberName(task.assignedMemberId)).toBe('household.tasks_member_unavailable');
    expect(component.areaName(task.spaceId)).toBe('household.tasks_area_removed');
  });
});
