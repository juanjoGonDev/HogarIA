import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import {
  HouseholdMealProposalService,
  type AssistantHouseholdMealProposalRefinementRequest,
  type AssistantHouseholdMealProposalRequest,
  type HouseholdMealProposal,
  type HouseholdMealProposalConfirmation,
  type HouseholdMealProposalConfirmRequest,
  type HouseholdMealProposalRequest
} from './household-meal-proposal.service';

describe('HouseholdMealProposalService', () => {
  let service: HouseholdMealProposalService;
  let http: HttpTestingController;

  const proposalRequest: HouseholdMealProposalRequest = {
    weekStart: '2026-10-12',
    householdMemberIds: ['member-1']
  };
  const proposal: HouseholdMealProposal = {
    proposalId: 'proposal-1',
    weekStart: '2026-10-12',
    participants: [],
    recipes: [],
    events: []
  };
  const confirmationRequest: HouseholdMealProposalConfirmRequest = {
    ...proposalRequest,
    proposalId: 'proposal-1',
    recipes: [],
    events: []
  };
  const assistantProposalRequest: AssistantHouseholdMealProposalRequest = {
    ...proposalRequest,
    instructions: 'Comidas sencillas.'
  };
  const assistantRefinementRequest: AssistantHouseholdMealProposalRefinementRequest = {
    ...confirmationRequest,
    instructions: 'Cambia el arroz por pasta.'
  };
  const confirmation: HouseholdMealProposalConfirmation = {
    proposalId: 'proposal-1',
    weekStart: '2026-10-12',
    idempotent: false,
    events: [],
    unresolvedEvents: []
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HouseholdMealProposalService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends a proposal request scoped to the household and returns the envelope data', () => {
    let result: HouseholdMealProposal | undefined;
    service.createProposal('home-1', proposalRequest).subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/meal-planning/proposal');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    expect(request.request.body).toEqual(proposalRequest);
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true, data: proposal });

    expect(result).toEqual(proposal);
  });

  it('confirms the selected proposal using the household scope and the same silent-error context', () => {
    let result: HouseholdMealProposalConfirmation | undefined;
    service.confirmProposal('home-2', confirmationRequest).subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/meal-planning/confirm');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-household-id')).toBe('home-2');
    expect(request.request.body).toEqual(confirmationRequest);
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true, data: confirmation });

    expect(result).toEqual(confirmation);
  });

  it('generates assistant meal drafts through the transient assistant endpoint', () => {
    let result: HouseholdMealProposal | undefined;
    service.createAssistantProposal('home-3', assistantProposalRequest).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne('/api/ai/assistant/meal-proposals');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-assistant-household-id')).toBe('home-3');
    expect(request.request.headers.has('x-household-id')).toBeFalse();
    expect(request.request.body).toEqual(assistantProposalRequest);
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true, data: proposal });

    expect(result).toEqual(proposal);
  });

  it('refines a meal draft without confirming or writing it', () => {
    let result: HouseholdMealProposal | undefined;
    service.refineAssistantProposal('home-4', assistantRefinementRequest).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne('/api/ai/assistant/meal-proposals/refine');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-assistant-household-id')).toBe('home-4');
    expect(request.request.body).toEqual(assistantRefinementRequest);
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true, data: proposal });

    expect(result).toEqual(proposal);
  });

  it('rejects an unsuccessful proposal envelope without data', () => {
    let receivedError: unknown;
    service.createProposal('home-1', proposalRequest).subscribe({
      error: (error: unknown) => (receivedError = error)
    });
    http.expectOne('/api/household/meal-planning/proposal').flush({ success: false });

    expect(receivedError).toEqual(
      jasmine.objectContaining({ message: 'INVALID_MEAL_PROPOSAL_RESPONSE' })
    );
  });

  it('rejects a successful confirmation envelope whose data is missing', () => {
    let receivedError: unknown;
    service.confirmProposal('home-1', confirmationRequest).subscribe({
      error: (error: unknown) => (receivedError = error)
    });
    http.expectOne('/api/household/meal-planning/confirm').flush({ success: true });

    expect(receivedError).toEqual(
      jasmine.objectContaining({ message: 'INVALID_MEAL_PROPOSAL_RESPONSE' })
    );
  });
});
