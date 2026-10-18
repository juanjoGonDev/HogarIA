import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { RouteFeatureStylesService } from './route-feature-styles.service';

describe('RouteFeatureStylesService', () => {
  let service: RouteFeatureStylesService;
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
    service = TestBed.inject(RouteFeatureStylesService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('coalesces each feature bundle independently and reuses a loaded stylesheet', async () => {
    const first = service.loadStyles('household');
    const concurrent = service.loadStyles('household');
    const calendar = service.loadStyles('calendar');
    const householdLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-route-style="household"]'
    );
    const calendarLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-route-style="calendar"]'
    );

    expect(concurrent).toBe(first);
    expect(first).not.toBe(calendar);
    expect(householdLink?.href).toBe('https://hogaria.test/app/household-feature.css');
    expect(calendarLink?.href).toBe('https://hogaria.test/app/calendar-feature.css');
    householdLink?.dispatchEvent(new Event('load'));
    calendarLink?.dispatchEvent(new Event('load'));
    await first;
    await calendar;

    await service.loadStyles('household');
    expect(document.head.querySelectorAll('link[data-route-style="household"]').length).toBe(1);
    expect(document.head.querySelectorAll('link[data-route-style="calendar"]').length).toBe(1);
  });

  it('removes a failed feature link and permits a clean retry', async () => {
    const failedLoad = service.loadStyles('calendar');
    const failedLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-route-style="calendar"]'
    );
    failedLink?.dispatchEvent(new Event('error'));

    await expectAsync(failedLoad).toBeRejectedWithError(
      'No se pudieron cargar los estilos del calendario.'
    );
    expect(failedLink?.isConnected).toBeFalse();

    const retry = service.loadStyles('calendar');
    const retryLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-route-style="calendar"]'
    );
    expect(retryLink).not.toBe(failedLink);
    retryLink?.dispatchEvent(new Event('load'));
    await retry;
  });

  it('releases only the leaving route stylesheet and reloads on re-entry', async () => {
    const householdLoad = service.loadStyles('household');
    const calendarLoad = service.loadStyles('calendar');
    const link = document.head.querySelector<HTMLLinkElement>('link[data-route-style="household"]');
    const calendarLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-route-style="calendar"]'
    );
    link?.dispatchEvent(new Event('load'));
    calendarLink?.dispatchEvent(new Event('load'));
    await Promise.all([householdLoad, calendarLoad]);

    service.releaseStyles('household');
    expect(document.head.querySelector('link[data-route-style="household"]')).toBeNull();
    expect(calendarLink?.isConnected).toBeTrue();

    const reentry = service.loadStyles('household');
    const reentryLink = document.head.querySelector<HTMLLinkElement>(
      'link[data-route-style="household"]'
    );
    expect(reentryLink).not.toBe(link);
    reentryLink?.dispatchEvent(new Event('load'));
    await reentry;
  });
});
