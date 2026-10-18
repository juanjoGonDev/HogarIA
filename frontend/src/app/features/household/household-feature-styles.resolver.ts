import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { HouseholdFeatureStylesService } from './household-feature-styles.service';

export const householdFeatureStylesResolver: ResolveFn<boolean> = () =>
  inject(HouseholdFeatureStylesService)
    .loadHouseholdStyles()
    .then(() => true);
