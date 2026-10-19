import { Routes } from '@angular/router';

export const AI_CONFIG_ROUTES: Routes = [
  {
    path: ':configId/queue',
    loadComponent: () =>
      import('./ai-provider-queue-page.component').then((m) => m.AiProviderQueuePageComponent)
  },
  {
    path: '',
    loadComponent: () => import('./ai-config.component').then((m) => m.AiConfigComponent)
  }
];
