import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import {
  RouteFeatureStylesService,
  type RouteFeatureStyleBundle
} from './route-feature-styles.service';

export const routeFeatureStylesResolver =
  (bundleName: RouteFeatureStyleBundle): ResolveFn<boolean> =>
  () =>
    inject(RouteFeatureStylesService)
      .loadStyles(bundleName)
      .then(() => true);
