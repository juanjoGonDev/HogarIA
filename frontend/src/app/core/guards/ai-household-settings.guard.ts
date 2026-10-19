import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { map } from 'rxjs';
import { HouseholdService } from '../services/household.service';

/** Keeps direct navigation to the AI provider screen aligned with the server's settings ACL. */
export const aiHouseholdSettingsGuard: CanActivateFn = () => {
  const household = inject(HouseholdService);
  const router = inject(Router);

  return household.loadMemberships().pipe(
    map((memberships) => {
      if (household.membershipsFailed()) return router.parseUrl('/dashboard');
      if (memberships.length === 0) return true;

      const activeId = household.activeHouseholdId();
      if (!activeId) return router.parseUrl('/household');
      const active = memberships.find((membership) => membership.id === activeId);
      return active?.permissions?.settings === true
        ? true
        : router.parseUrl('/household?tab=settings');
    })
  );
};
