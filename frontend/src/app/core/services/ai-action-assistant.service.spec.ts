import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { toDayKey } from '../time';
import { HouseholdService } from './household.service';
import type {
  AssistantActionPlan,
  AssistantActionRefinementResult,
  AssistantBatchRefinementResult
} from '../../shared/models/ai-action-assistant.model';
import { AiActionAssistantService } from './ai-action-assistant.service';

describe('AiActionAssistantService', () => {
  let service: AiActionAssistantService;
  let http: HttpTestingController;
  let activeHouseholdId: WritableSignal<string | null>;

  beforeEach(() => {
    activeHouseholdId = signal('household-1');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: HouseholdService, useValue: { activeHouseholdId } }
      ]
    });
    service = TestBed.inject(AiActionAssistantService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts proposal input to the read-only route and returns a normalized plan', () => {
    const plan: AssistantActionPlan = {
      id: 'plan-1',
      summary: 'Añadir lentejas',
      actions: [],
      questions: []
    };
    let result: AssistantActionPlan | undefined;
    const localReferenceDate = toDayKey(new Date());
    service
      .propose({ prompt: 'Añade lentejas', route: 'pantry' })
      .subscribe((value) => (result = value));

    const request = http.expectOne('/api/ai/assistant/proposals');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      prompt: 'Añade lentejas',
      route: 'pantry',
      referenceDate: localReferenceDate
    });
    expect(request.request.headers.get('x-assistant-household-id')).toBe('household-1');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true, data: plan });

    expect(result).toEqual(plan);
  });

  it('sends an empty household header when no household context is active', () => {
    activeHouseholdId.set(null);
    service.propose({ prompt: 'Añade lentejas' }).subscribe();

    const request = http.expectOne('/api/ai/assistant/proposals');
    expect(request.request.headers.get('x-assistant-household-id')).toBe('');
    request.flush({
      success: true,
      data: { id: 'plan-1', summary: '', actions: [], questions: [] }
    });
  });

  it('rejects unsuccessful, empty, or null API envelopes', () => {
    const invalidResponses = [{ success: false, data: undefined }, { success: true }, null];

    for (const response of invalidResponses) {
      let error: unknown;
      service
        .propose({ prompt: 'Añade lentejas' })
        .subscribe({ error: (value) => (error = value) });

      http.expectOne('/api/ai/assistant/proposals').flush(response as never);

      expect(error).toEqual(jasmine.any(Error));
      expect((error as Error).message).toBe('AI assistant returned an invalid response');
    }
  });

  it('sends a single scoped refinement and propagates provider errors to the dialog', () => {
    const refinement: AssistantActionRefinementResult = {
      actionId: 'action-1',
      summary: 'Cantidad revisada',
      replacement: null,
      questions: ['¿Qué cantidad prefieres?']
    };
    let result: AssistantActionRefinementResult | undefined;
    let error: HttpErrorResponse | undefined;
    const input = {
      actionId: 'action-1',
      instruction: 'Reduce la cantidad',
      action: {} as never,
      scope: { kind: 'field' as const, path: ['quantity'] }
    };
    const localReferenceDate = toDayKey(new Date());
    service
      .refine(input)
      .subscribe({ next: (value) => (result = value), error: (value) => (error = value) });

    const request = http.expectOne('/api/ai/assistant/refine');
    expect(request.request.body).toEqual(
      jasmine.objectContaining({
        actionId: 'action-1',
        instruction: 'Reduce la cantidad',
        scope: input.scope,
        referenceDate: localReferenceDate
      })
    );
    expect(request.request.headers.get('x-assistant-household-id')).toBe('household-1');
    request.flush({ success: true, data: refinement });
    expect(result).toEqual(refinement);

    service.refine(input).subscribe({ error: (value) => (error = value) });
    http
      .expectOne('/api/ai/assistant/refine')
      .flush(
        { success: false, code: 'AI_NOT_CONFIGURED' },
        { status: 503, statusText: 'Service Unavailable' }
      );
    expect(error?.status).toBe(503);
  });

  it('sends one explicit batch refinement request and returns app-correlated replacements', () => {
    const resultData: AssistantBatchRefinementResult = {
      summary: 'Lote más sencillo',
      replacements: [{ actionId: 'action-1', replacement: {} as never }],
      questions: []
    };
    let result: AssistantBatchRefinementResult | undefined;
    const input = {
      instruction: 'Simplifica el lote',
      actions: [
        { actionId: 'action-1', action: {} as never },
        { actionId: 'action-2', action: {} as never }
      ],
      scope: { kind: 'batch' as const }
    };
    const localReferenceDate = toDayKey(new Date());
    service.refineBatch(input).subscribe((value) => (result = value));

    const request = http.expectOne('/api/ai/assistant/refine-batch');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ...input, referenceDate: localReferenceDate });
    expect(request.request.headers.get('x-assistant-household-id')).toBe('household-1');
    request.flush({ success: true, data: resultData });

    expect(result).toEqual(resultData);
  });
});
