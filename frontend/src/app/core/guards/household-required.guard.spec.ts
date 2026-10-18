import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { HouseholdService } from '../services/household.service';
import { householdRequiredGuard } from './household-required.guard';

describe('householdRequiredGuard', () => {
  let router: jasmine.SpyObj<Router>;
  let household: HouseholdService;
  let activeHouseholdId: string | null;
  let loadMembershipsForNavigation: jasmine.Spy;
  let destination: UrlTree;

  beforeEach(() => {
    destination = {} as UrlTree;
    router = jasmine.createSpyObj<Router>('Router', ['createUrlTree', 'getCurrentNavigation']);
    router.createUrlTree.and.returnValue(destination);
    router.getCurrentNavigation.and.returnValue({ id: 7 } as never);
    activeHouseholdId = null;
    loadMembershipsForNavigation = jasmine
      .createSpy('loadMembershipsForNavigation')
      .and.returnValue(of([]));
    household = {
      loadMembershipsForNavigation,
      activeHouseholdId: () => activeHouseholdId
    } as unknown as HouseholdService;

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: HouseholdService, useValue: household }
      ]
    });
  });

  function run(url: string): ReturnType<typeof householdRequiredGuard> {
    return TestBed.runInInjectionContext(() =>
      householdRequiredGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
    );
  }

  it('allows the household route so a member can create or join a home', async () => {
    expect(await firstValueFrom(run('/household') as Observable<boolean | UrlTree>)).toBeTrue();
    expect(loadMembershipsForNavigation).not.toHaveBeenCalled();
  });

  it('allows protected routes only after confirming the active household membership', async () => {
    activeHouseholdId = 'home-1';
    loadMembershipsForNavigation.and.returnValue(of([{ id: 'home-1' }] as never));

    expect(await firstValueFrom(run('/dashboard') as Observable<boolean | UrlTree>)).toBeTrue();
    expect(loadMembershipsForNavigation).toHaveBeenCalledOnceWith(7);
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects a user without an active membership to household setup', async () => {
    const result = await firstValueFrom(run('/calendar') as Observable<boolean | UrlTree>);

    expect(result).toBe(destination);
    expect(loadMembershipsForNavigation).toHaveBeenCalledOnceWith(7);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/household']);
  });

  it('does not trust a stale active household id missing from the refreshed membership list', async () => {
    activeHouseholdId = 'removed-home';
    loadMembershipsForNavigation.and.returnValue(of([{ id: 'another-home' }] as never));

    const result = await firstValueFrom(run('/dashboard') as Observable<boolean | UrlTree>);

    expect(result).toBe(destination);
  });

  it('fails closed to setup when membership verification cannot complete', async () => {
    loadMembershipsForNavigation.and.returnValue(throwError(() => new Error('offline')));

    const result = await firstValueFrom(run('/dashboard') as Observable<boolean | UrlTree>);

    expect(result).toBe(destination);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/household']);
  });
});
