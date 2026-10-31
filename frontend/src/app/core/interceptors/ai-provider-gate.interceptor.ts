import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, switchMap } from 'rxjs';
import type { AiFunctionKey } from '../../shared/models/ai-config.model';
import { AiProviderAvailabilityService } from '../services/ai-provider-availability.service';

export function aiFunctionForRequest(method: string, rawUrl: string): AiFunctionKey | null {
  if (method.toUpperCase() !== 'POST') return null;

  let path = rawUrl;
  try {
    path = new URL(rawUrl, globalThis.location?.origin ?? 'http://localhost').pathname;
  } catch {
    // Keep the supplied relative path; the route patterns below are anchored.
  }
  path = path.replace(/\/+$/, '');

  if (
    /^\/api\/ai\/assistant\/(?:proposals|refine|refine-batch|meal-proposals(?:\/refine)?)$/.test(
      path
    )
  ) {
    return 'assistant';
  }
  if (
    /^\/api\/ai\/(?:generate-recipe|generate-multiple-recipes|improve-recipe|recommendations|replace-meal)$/.test(
      path
    )
  ) {
    return 'recipes';
  }
  if (
    path === '/api/ai/plan-week' ||
    path === '/api/household/meal-planning/proposal' ||
    path === '/api/household/plan/proposal'
  ) {
    return 'planning';
  }
  if (
    path === '/api/pantry/expiry/estimate' ||
    /^\/api\/shopping\/lists\/[^/]+\/photo\/analyze$/.test(path) ||
    path === '/api/receipts' ||
    /^\/api\/receipts\/[^/]+\/retry$/.test(path)
  ) {
    return 'shopping_pantry';
  }
  return null;
}

/** Stops AI actions locally when their assigned function has no active provider. */
export const aiProviderGateInterceptor: HttpInterceptorFn = (request, next) => {
  const functionKey = aiFunctionForRequest(request.method, request.url);
  if (!functionKey) return next(request);

  const availability = inject(AiProviderAvailabilityService);
  return availability.load().pipe(
    switchMap((state) => {
      if (!state || state.functions[functionKey] === true) return next(request);
      availability.openSetup(functionKey);
      // Empty completes the caller's observable without an HTTP error/toast. The global modal
      // explains the missing provider and links directly to its settings surface.
      return EMPTY;
    })
  );
};
