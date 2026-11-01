export const aiActivityEs = {
  'ai_activity.active_jobs_label':
    'Actividad de IA en marcha: {total} · {queued} en cola, {running} en curso'
} as const;

export const aiActivityEn: Record<keyof typeof aiActivityEs, string> = {
  'ai_activity.active_jobs_label':
    'AI activity: {total} active · {queued} queued, {running} running'
};
