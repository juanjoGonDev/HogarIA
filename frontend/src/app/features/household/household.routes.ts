import { Routes } from '@angular/router';

export const HOUSEHOLD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./household.component').then((m) => m.HouseholdComponent)
  }
];
