import { Routes } from '@angular/router';

export const PREFERENCES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./preferences.component').then((m) => m.PreferencesComponent)
  }
];
