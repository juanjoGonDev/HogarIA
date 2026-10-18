import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { HouseholdFeatureStylesService } from './household-feature-styles.service';

describe('HouseholdFeatureStylesService', () => {
  let service: HouseholdFeatureStylesService;
  let document: Document;

  beforeEach(() => {
    document = window.document.implementation.createHTMLDocument();
    Object.defineProperty(document, 'baseURI', {
      configurable: true,
      value: 'https://hogaria.test/app/'
    });
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: document }]
    });
    service = TestBed.inject(HouseholdFeatureStylesService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('coalesces concurrent requests and reuses the loaded stylesheet', async () => {
    const first = service.loadHouseholdStyles();
    const concurrent = service.loadHouseholdStyles();
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[data-household-feature-styles]'
    );

    expect(concurrent).toBe(first);
    expect(link?.href).toBe('https://hogaria.test/app/household-feature.css');
    link?.dispatchEvent(new Event('load'));
    await first;

    await service.loadHouseholdStyles();
    expect(document.head.querySelectorAll('link[data-household-feature-styles]').length).toBe(1);
  });

  it('removes a failed link and permits a clean retry', async () => {
    const failedLoad = service.loadHouseholdStyles();
    const failedLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-household-feature-styles]'
    );
    failedLink?.dispatchEvent(new Event('error'));

    await expectAsync(failedLoad).toBeRejectedWithError(
      'No se pudieron cargar los estilos de Hogar.'
    );
    expect(failedLink?.isConnected).toBeFalse();

    const retry = service.loadHouseholdStyles();
    const retryLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-household-feature-styles]'
    );
    expect(retryLink).not.toBe(failedLink);
    retryLink?.dispatchEvent(new Event('load'));
    await retry;
  });

  it('releases the route stylesheet when leaving Hogar', async () => {
    const load = service.loadHouseholdStyles();
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[data-household-feature-styles]'
    );
    link?.dispatchEvent(new Event('load'));
    await load;

    service.releaseHouseholdStyles();
    expect(document.head.querySelector('link[data-household-feature-styles]')).toBeNull();
  });
});
