import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import type { HouseholdTaskOccurrence } from '../../shared/models/household-task.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { HouseholdTasksService } from './household-tasks.service';

const API_URL = `${environment.apiUrl}/household/tasks`;

const task: HouseholdTaskOccurrence = {
  id: 'task-synthetic',
  title: 'Limpiar la cocina',
  details: null,
  spaceId: 'kitchen',
  scheduledDate: '2026-10-05',
  assignedMemberId: 'member-a',
  completed: false
};

describe('HouseholdTasksService', () => {
  let service: HouseholdTasksService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [HouseholdTasksService]
    });
    service = TestBed.inject(HouseholdTasksService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads a specific home week with silent error handling', () => {
    let result: unknown;
    service.load('home-a', '2026-10-05').subscribe((value) => (result = value));
    const request = http.expectOne(`${API_URL}?weekStart=2026-10-05`);

    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('x-household-id')).toBe('home-a');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({
      success: true,
      data: { weekStart: '2026-10-05', version: 1, tasks: [task] }
    });
    expect(result).toEqual({ weekStart: '2026-10-05', version: 1, tasks: [task] });
  });

  it('saves the whole week using the version for conflict detection', () => {
    let result: unknown;
    service.save('home-a', '2026-10-05', 4, [task]).subscribe((value) => (result = value));
    const request = http.expectOne(API_URL);

    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('x-household-id')).toBe('home-a');
    expect(request.request.body).toEqual({
      weekStart: '2026-10-05',
      baseVersion: 4,
      tasks: [task]
    });
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({
      success: true,
      data: { weekStart: '2026-10-05', version: 5, tasks: [task] }
    });
    expect(result).toEqual({ weekStart: '2026-10-05', version: 5, tasks: [task] });
  });
});
