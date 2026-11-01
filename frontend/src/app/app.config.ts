import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { aiProviderGateInterceptor } from './core/interceptors/ai-provider-gate.interceptor';
import { aiActiveJobsInterceptor } from './core/interceptors/ai-active-jobs.interceptor';
import { skipUnavailableViewTransition } from './core/router/view-transition-utils';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withViewTransitions({
        onViewTransitionCreated: ({ transition }) => skipUnavailableViewTransition(transition)
      })
    ),
    provideHttpClient(
      withInterceptors([
        authInterceptor,
        aiProviderGateInterceptor,
        aiActiveJobsInterceptor,
        errorInterceptor
      ])
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
