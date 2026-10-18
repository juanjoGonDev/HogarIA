import { routes } from './app.routes';
import { authGuard } from './core/guards/auth.guard';
import { householdRequiredGuard } from './core/guards/household-required.guard';

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
});
