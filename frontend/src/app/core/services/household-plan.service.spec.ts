import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  HouseholdPlan,
  HouseholdPlanProposal,
  VersionedHouseholdPlan
} from '../../shared/models/household-plan.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { HouseholdPlanService } from './household-plan.service';

const API_URL = '/api/household/plan';

function plan(): HouseholdPlan {
  return {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: 'Plano sintético',
    warnings: [],
    floors: [
      {
        id: 'floor-0',
        name: 'Planta baja',
        level: 0,
        walls: [],
        openings: [],
        spaces: []
      }
    ]
  };
}

describe('HouseholdPlanService', () => {
  let service: HouseholdPlanService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [HouseholdPlanService]
    });
    service = TestBed.inject(HouseholdPlanService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads and saves versioned data through the household plan API', () => {
    const empty: VersionedHouseholdPlan = { version: 0, plan: null };
    let loaded: VersionedHouseholdPlan | undefined;
    service.load('home-a').subscribe((result) => (loaded = result));
    const get = http.expectOne(API_URL);
    expect(get.request.method).toBe('GET');
    expect(get.request.headers.get('x-household-id')).toBe('home-a');
    expect(get.request.context.get(SILENT_TOAST)).toBeTrue();
    get.flush({ success: true, data: empty });
    expect(loaded).toEqual(empty);

    const currentPlan = plan();
    let saved: VersionedHouseholdPlan | undefined;
    service.save('home-a', 0, currentPlan).subscribe((result) => (saved = result));
    const put = http.expectOne(API_URL);
    expect(put.request.method).toBe('PUT');
    expect(put.request.headers.get('x-household-id')).toBe('home-a');
    expect(put.request.body).toEqual({ baseVersion: 0, plan: currentPlan });
    put.flush({ success: true, data: { version: 1, plan: currentPlan } });
    expect(saved).toEqual({ version: 1, plan: currentPlan });
  });

  it('sends chat proposals as JSON and keeps local plan context outside persistence', () => {
    const currentPlan = plan();
    const proposal: HouseholdPlanProposal = {
      baseVersion: 4,
      current: currentPlan,
      draft: currentPlan,
      proposal: currentPlan,
      diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
      orphanedTaskIds: []
    };
    let result: HouseholdPlanProposal | undefined;
    service
      .propose({
        householdId: 'home-a',
        baseVersion: 4,
        prompt: 'Añade un balcón',
        draftPlan: currentPlan
      })
      .subscribe((value) => (result = value));
    const post = http.expectOne(`${API_URL}/proposal`);
    expect(post.request.method).toBe('POST');
    expect(post.request.headers.get('x-household-id')).toBe('home-a');
    expect(post.request.body).toEqual({
      baseVersion: 4,
      prompt: 'Añade un balcón',
      draftPlan: currentPlan
    });
    post.flush({ success: true, data: proposal });
    expect(result).toEqual(proposal);
    http.expectNone(API_URL);
  });

  it('sends the exact task occurrences the user confirmed before removing their zones', () => {
    const currentPlan = plan();
    service.save('home-a', 5, currentPlan, ['task-monday', 'task-thursday']).subscribe();
    const put = http.expectOne(API_URL);
    expect(put.request.body).toEqual({
      baseVersion: 5,
      plan: currentPlan,
      confirmOrphanedTaskIds: ['task-monday', 'task-thursday']
    });
    put.flush({ success: true, data: { version: 6, plan: currentPlan } });
  });

  it('uploads a sketch as multipart without setting a JSON content type', () => {
    const file = new File(['synthetic'], 'local-sketch.png', { type: 'image/png' });
    const currentPlan = plan();
    service
      .propose({
        householdId: 'home-a',
        baseVersion: 2,
        prompt: 'Interpreta este boceto',
        attachment: file,
        draftPlan: currentPlan
      })
      .subscribe();
    const post = http.expectOne(`${API_URL}/proposal`);
    expect(post.request.method).toBe('POST');
    expect(post.request.headers.get('x-household-id')).toBe('home-a');
    expect(post.request.body).toBeInstanceOf(FormData);
    const form = post.request.body as FormData;
    expect(form.get('baseVersion')).toBe('2');
    expect(form.get('prompt')).toBe('Interpreta este boceto');
    expect(form.get('image')).toBe(file);
    expect(form.get('draftPlan')).toBe(JSON.stringify(currentPlan));
    expect(post.request.headers.has('Content-Type')).toBeFalse();
    post.flush({
      success: true,
      data: {
        baseVersion: 2,
        current: currentPlan,
        draft: currentPlan,
        proposal: currentPlan,
        diff: { addedSpaceIds: [], modifiedSpaceIds: [], removedSpaceIds: [] },
        orphanedTaskIds: []
      }
    });
  });
});
