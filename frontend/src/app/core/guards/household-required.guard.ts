import { inject } from '@angular/core';
import { Router, type CanActivateChildFn } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { HouseholdService } from '../services/household.service';

/** Require a server-confirmed active household before entering household-scoped app routes. */
export const householdRequiredGuard: CanActivateChildFn = (_route, state) => {
  const householdService = inject(HouseholdService);
  const router = inject(Router);
  const path = state.url.split(/[?#]/, 1)[0];

  // This screen is the recovery/onboarding route: members without a home must be able to create or join.
  if (path === '/household' || path.startsWith('/household/')) return of(true);

  const navigationId = router.getCurrentNavigation()?.id ?? null;
  return householdService.loadMembershipsForNavigation(navigationId).pipe(
    map((memberships) => {
      const activeHouseholdId = householdService.activeHouseholdId();
      const hasActiveMembership =
        typeof activeHouseholdId === 'string' &&
        memberships.some((membership) => membership.id === activeHouseholdId);
      return hasActiveMembership ? true : router.createUrlTree(['/household']);
    }),
    // Fail closed for protected screens, but leave account recovery/create/join accessible.
    catchError(() => of(router.createUrlTree(['/household'])))
  );
};
