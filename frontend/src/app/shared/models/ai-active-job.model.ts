/** Global, user-scoped summary of AI work that has not reached a terminal state. */
export type AiActiveJobStatus = 'queued' | 'running';

export interface AiActiveJob {
  id: string;
  kind: string;
  status: AiActiveJobStatus;
  createdAt: string;
  startedAt: string | null;
}

export interface AiActiveJobsResponse {
  success: true;
  data: { jobs: AiActiveJob[] };
}
