import { routes } from './app.routes';

describe('application routes', () => {
  it('loads the public invitation component only when its route is visited', () => {
    const inviteRoute = routes.find((route) => route.path === 'invite/:code');

    expect(inviteRoute).toBeDefined();
    expect(inviteRoute?.component).toBeUndefined();
    expect(typeof inviteRoute?.loadComponent).toBe('function');
    expect(inviteRoute?.canActivate).toBeUndefined();
    expect(inviteRoute?.resolve?.['translations']).toBeDefined();
  });
});
