export type AiQueueJobStatus = 'queued' | 'running' | 'failed';

export type AiQueueJobKind =
  | 'receipt'
  | 'recipe'
  | 'multiple_recipes'
  | 'recommendations'
  | 'weekly_plan'
  | 'shopping_photo'
  | 'expiry_estimate'
  | 'connection_test';

export type AiJobDiagnosticTraceStage =
  | 'worker_claimed'
  | 'worker_started'
  | 'runtime_started'
  | 'runtime_finished'
  | 'runtime_failed'
  | 'worker_exception'
  | 'worker_stalled'
  | 'worker_runtime_missing'
  | 'worker_scope_mismatch'
  | 'provider_submitting'
  | 'provider_queued'
  | 'provider_polling'
  | 'provider_completed'
  | 'provider_failed'
  | 'provider_timed_out'
  | 'provider_cancelled';

/** Safe per-job lifecycle metadata; never contains a request body or provider message. */
export interface AiJobDiagnosticTraceEvent {
  at: string;
  attempt: number;
  claimGeneration: number;
  stage: AiJobDiagnosticTraceStage;
  code?: string;
  httpStatus?: number;
  responseId?: string;
  elapsedMs?: number;
}

/** Safe metadata only: request bodies, prompts, files, results and credentials never belong here. */
export interface AiQueueJob {
  id: string;
  configId: string;
  kind: AiQueueJobKind | (string & {});
  status: AiQueueJobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  /** True only when the server retained all input needed to execute a manual retry. */
  retryable: boolean;
  createdAt: string;
  queueOrder: number;
  providerResponseId?: string | null;
  providerTransport?: 'responses_background' | 'chat_completions' | null;
  providerHttpStatus?: number | null;
  providerErrorType?: string | null;
  providerErrorCode?: string | null;
  providerErrorParam?: string | null;
  elapsedMs?: number | null;
  diagnosticStage?:
    | 'submitting'
    | 'queued'
    | 'polling'
    | 'completed'
    | 'failed'
    | 'timed_out'
    | 'cancelled'
    | 'fallback'
    | null;
  diagnosticTrace?: AiJobDiagnosticTraceEvent[];
}

export interface AiQueueSnapshot {
  configId: string;
  jobs: AiQueueJob[];
}

export interface AiQueueState {
  snapshot: AiQueueSnapshot | null;
  loading: boolean;
  loadError: boolean;
  mutating: boolean;
  actionError: boolean;
}

export interface AiQueueSnapshotResponse {
  data: AiQueueSnapshot;
}
