import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { I18nService } from '../services/i18n.service';
import { translationBundlesResolver } from './translation-bundles.resolver';

describe('translationBundlesResolver', () => {
  it('loads route dictionaries before resolving the page', async () => {
    TestBed.configureTestingModule({ providers: [I18nService] });
    const i18n = TestBed.inject(I18nService);
    const load = spyOn(i18n, 'loadTranslations').and.resolveTo();
    const resolver = translationBundlesResolver('pantry', 'calendar');

    const result = await TestBed.runInInjectionContext(() =>
      resolver({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    expect(result).toBeTrue();
    expect(load).toHaveBeenCalledOnceWith('pantry', 'calendar');
  });
});
