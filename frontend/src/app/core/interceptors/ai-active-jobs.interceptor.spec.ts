import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { isAiExecutionRequest, aiActiveJobsInterceptor } from './ai-active-jobs.interceptor';
import { AiActiveJobsService } from '../services/ai-active-jobs.service';

const ACTIVE_URL = '/api/ai/queue/active';

describe('isAiExecutionRequest', () => {
  it('recognizes user-triggered model routes, including endpoints outside the provider gate', () => {
    const routes = [
      '/api/ai/generate-recipe',
      '/api/ai/assistant/proposals',
      '/api/household/meal-planning/proposal',
      '/api/household/plan/proposal',
      '/api/ai/test-connection',
      '/api/household/planning-automation/retry',
      '/api/pantry/expiry/estimate',
      '/api/shopping/lists/synthetic-list/photo/analyze',
      '/api/receipts'
    ];
    for (const route of routes)
      expect(isAiExecutionRequest('POST', route)).withContext(route).toBeTrue();
  });

  it('excludes queue polling, reads, configuration changes, and unrelated writes', () => {
    expect(isAiExecutionRequest('GET', ACTIVE_URL)).toBeFalse();
    expect(isAiExecutionRequest('GET', '/api/ai/configs')).toBeFalse();
    expect(isAiExecutionRequest('PATCH', '/api/ai/configs/provider-1')).toBeFalse();
    expect(isAiExecutionRequest('POST', '/api/shopping/lists')).toBeFalse();
  });
});

describe('aiActiveJobsInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let service: AiActiveJobsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([aiActiveJobsInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    service = TestBed.inject(AiActiveJobsService);
  });

  afterEach(() => http.verify());

  it('refreshes on AI request start and completion, without intercepting its own active-job read', () => {
    let result: unknown;
    client.post('/api/ai/generate-recipe', {}).subscribe((value) => (result = value));

    const started = http.expectOne(ACTIVE_URL);
    http.expectOne('/api/ai/generate-recipe').flush({ success: true });
    started.flush({ success: true, data: { jobs: [] } });
    http.expectOne(ACTIVE_URL).flush({ success: true, data: { jobs: [] } });

    expect(result).toEqual({ success: true });
    expect(service.jobs()).toEqual([]);
  });

  it('refreshes after a failed AI request as well', () => {
    client.post('/api/ai/test-connection', {}).subscribe({ error: () => undefined });
    http.expectOne(ACTIVE_URL).flush({ success: true, data: { jobs: [] } });
    http.expectOne('/api/ai/test-connection').flush({}, { status: 502, statusText: 'Bad Gateway' });
    http.expectOne(ACTIVE_URL).flush({ success: true, data: { jobs: [] } });
    expect(service.jobs()).toEqual([]);
  });

  it('does not refresh for an unrelated mutation', () => {
    client.post('/api/shopping/lists', {}).subscribe();
    http.expectOne('/api/shopping/lists').flush({ success: true });
    http.expectNone(ACTIVE_URL);
    expect(service.jobs()).toEqual([]);
  });
});
