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
