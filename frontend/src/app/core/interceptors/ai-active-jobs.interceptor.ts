import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { aiFunctionForRequest } from './ai-provider-gate.interceptor';
import { AiActiveJobsService } from '../services/ai-active-jobs.service';

function pathOf(rawUrl: string): string {
  try {
    return new URL(rawUrl, globalThis.location?.origin ?? 'http://localhost').pathname.replace(
      /\/+$/,
      ''
    );
  } catch {
    return rawUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

/** Model-producing HTTP routes already known by the provider gate, plus operations it does not gate. */
export function isAiExecutionRequest(method: string, rawUrl: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  if (aiFunctionForRequest(method, rawUrl)) return true;

  const path = pathOf(rawUrl);
  return path === '/api/ai/test-connection' || path === '/api/household/planning-automation/retry';
}

/** Keep the global activity status warm around AI calls without changing each feature service. */
export const aiActiveJobsInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isAiExecutionRequest(request.method, request.url)) return next(request);

  const stopTracking = inject(AiActiveJobsService).trackAiRequest();
  return next(request).pipe(finalize(stopTracking));
};
