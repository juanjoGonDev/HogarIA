import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { I18nService } from '../../core/services/i18n.service';

export const householdTranslationsResolver: ResolveFn<boolean> = () =>
  inject(I18nService)
    .loadHouseholdTranslations()
    .then(() => true);

export const HOUSEHOLD_ROUTES: Routes = [
  {
    path: '',
    resolve: { householdTranslations: householdTranslationsResolver },
    loadComponent: () => import('./household.component').then((m) => m.HouseholdComponent)
  }
];
