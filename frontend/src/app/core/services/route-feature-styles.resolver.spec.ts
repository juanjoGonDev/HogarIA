import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { RouteFeatureStylesService } from './route-feature-styles.service';
import { routeFeatureStylesResolver } from './route-feature-styles.resolver';

describe('routeFeatureStylesResolver', () => {
  let loadStyles: jasmine.Spy;

  beforeEach(() => {
    loadStyles = jasmine.createSpy('loadStyles').and.resolveTo();
    TestBed.configureTestingModule({
      providers: [{ provide: RouteFeatureStylesService, useValue: { loadStyles } }]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('waits for the selected feature stylesheet before resolving the route', async () => {
    const resolver = routeFeatureStylesResolver('calendar');
    const route = {} as ActivatedRouteSnapshot;
    const state = {} as RouterStateSnapshot;

    const result = TestBed.runInInjectionContext(() => resolver(route, state));

    await expectAsync(result).toBeResolvedTo(true);
    expect(loadStyles).toHaveBeenCalledOnceWith('calendar');
  });

  it('keeps stylesheet errors visible so navigation fails closed', async () => {
    const loadError = new Error('style load failed');
    loadStyles.and.rejectWith(loadError);
    const resolver = routeFeatureStylesResolver('household');
    const route = {} as ActivatedRouteSnapshot;
    const state = {} as RouterStateSnapshot;

    const result = TestBed.runInInjectionContext(() => resolver(route, state));

    await expectAsync(result).toBeRejectedWith(loadError);
    expect(loadStyles).toHaveBeenCalledOnceWith('household');
  });
});
