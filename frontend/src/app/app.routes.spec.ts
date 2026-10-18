import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, ResolveFn, RouterStateSnapshot } from '@angular/router';
import { routes } from './app.routes';
import { authGuard } from './core/guards/auth.guard';
import { householdRequiredGuard } from './core/guards/household-required.guard';
import { I18nService } from './core/services/i18n.service';

describe('application routes', () => {
  it('loads the public invitation component only when its route is visited', () => {
    const inviteRoute = routes.find((route) => route.path === 'invite/:code');

    expect(inviteRoute).toBeDefined();
    expect(inviteRoute?.component).toBeUndefined();
    expect(typeof inviteRoute?.loadComponent).toBe('function');
    expect(inviteRoute?.canActivate).toBeUndefined();
    expect(inviteRoute?.resolve?.['translations']).toBeDefined();
  });

  it('lazy loads the protected shell behind its existing guards', () => {
    const shellRoute = routes.find((route) => route.path === '');

    expect(shellRoute).toBeDefined();
    expect(shellRoute?.component).toBeUndefined();
    expect(typeof shellRoute?.loadComponent).toBe('function');
    expect(shellRoute?.canActivate).toContain(authGuard);
    expect(shellRoute?.canActivateChild).toContain(householdRequiredGuard);
  });

  it('loads translations for cooking-level labels rendered on the household route', async () => {
    const householdRoute = routes
      .find((route) => route.path === '')
      ?.children?.find((route) => route.path === 'household');
    const resolveTranslations = householdRoute?.resolve?.['translations'] as
      ResolveFn<boolean> | undefined;

    expect(resolveTranslations).toBeDefined();
    await TestBed.runInInjectionContext(() =>
      resolveTranslations!({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    expect(TestBed.inject(I18nService).t('auth.beginner')).toBe('Principiante');
  });
});
