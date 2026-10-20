import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { AiProviderAvailabilityService } from '../../core/services/ai-provider-availability.service';
import { AiActionAssistantLauncherComponent } from './ai-action-assistant-launcher.component';

describe('AiActionAssistantLauncherComponent', () => {
  let fixture: ComponentFixture<AiActionAssistantLauncherComponent> | null;
  let navigationEvents: Subject<unknown>;
  let router: { url: string; events: Subject<unknown> };
  let i18n: {
    changeTick: ReturnType<typeof signal<number>>;
    t: jasmine.Spy;
    loadAssistantTranslations: jasmine.Spy;
  };
  let toast: jasmine.SpyObj<ToastService>;
  let viewportDescriptor: PropertyDescriptor | undefined;
  let viewportHeight: number;
  let viewport: VisualViewport;
  let resizeListener: EventListenerOrEventListenerObject | undefined;
  let mediaMatches: boolean;
  let assistantConfigured: boolean;
  let availability: { isConfigured: jasmine.Spy; load: jasmine.Spy };

  beforeEach(async () => {
    fixture = null;
    navigationEvents = new Subject<unknown>();
    router = { url: '/dashboard', events: navigationEvents };
    const translations: Record<string, string> = {
      'ai_assistant.open': 'Abrir asistente de acciones con IA',
      'ai_assistant.load_error': 'No se pudo cargar el asistente. Vuelve a intentarlo.',
      'ui.error': 'Error'
    };
    i18n = {
      changeTick: signal(0),
      t: jasmine.createSpy('translate').and.callFake((key: string) => translations[key] ?? key),
      loadAssistantTranslations: jasmine
        .createSpy('loadAssistantTranslations')
        .and.returnValue(Promise.resolve())
    };
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error']);
    mediaMatches = false;
    assistantConfigured = true;
    availability = {
      isConfigured: jasmine
        .createSpy('isConfigured')
        .and.callFake((key: string) => (key === 'assistant' ? assistantConfigured : false)),
      load: jasmine.createSpy('load').and.returnValue(of(null))
    };
    viewportHeight = window.innerHeight;
    resizeListener = undefined;
    viewport = {
      get height() {
        return viewportHeight;
      },
      addEventListener: jasmine
        .createSpy('addEventListener')
        .and.callFake((_type: string, listener: EventListenerOrEventListenerObject) => {
          resizeListener = listener;
        }),
      removeEventListener: jasmine.createSpy('removeEventListener')
    } as unknown as VisualViewport;
    viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport
    });
    spyOn(window, 'matchMedia').and.callFake(() => ({ matches: mediaMatches }) as MediaQueryList);

    await TestBed.configureTestingModule({
      imports: [AiActionAssistantLauncherComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: I18nService, useValue: i18n },
        { provide: ToastService, useValue: toast },
        { provide: AiProviderAvailabilityService, useValue: availability }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AiActionAssistantLauncherComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = null;
    navigationEvents.complete();
    if (viewportDescriptor) {
      Object.defineProperty(window, 'visualViewport', viewportDescriptor);
    } else {
      Reflect.deleteProperty(window, 'visualViewport');
    }
  });

  it('starts at dashboard and updates route hints only for supported navigation ends', () => {
    const component = fixture!.componentInstance;
    const button = fixture!.nativeElement.querySelector(
      '[data-test="ai-assistant-open"]'
    ) as HTMLButtonElement;

    expect(component.routeHint()).toBe('dashboard');
    expect(button.getAttribute('aria-label')).toBe('Abrir asistente de acciones con IA');
    expect(button.title).toBe('Abrir asistente de acciones con IA');

    navigationEvents.next(new NavigationStart(1, '/calendar'));
    expect(component.routeHint()).toBe('dashboard');

    const routes = ['pantry', 'shopping', 'calendar', 'recipes', 'household'] as const;
    routes.forEach((route, index) => {
      navigationEvents.next(new NavigationEnd(index + 2, `/${route}`, `/${route}?view=current`));
      expect(component.routeHint()).toBe(route);
    });

    navigationEvents.next(new NavigationEnd(10, '/unsupported/path', '/unsupported/path'));
    expect(component.routeHint()).toBe('dashboard');
  });

  it('hides the assistant launcher when another AI function exists but assistant is unassigned', () => {
    assistantConfigured = false;
    fixture!.detectChanges();

    expect(availability.isConfigured).toHaveBeenCalledWith('assistant');
    expect(fixture!.nativeElement.querySelector('[data-test="ai-assistant-open"]')).toBeNull();
  });

  it('loads assistant translations before opening and closes on request', async () => {
    const component = fixture!.componentInstance;

    await component.open();
    expect(i18n.loadAssistantTranslations).toHaveBeenCalledOnceWith();
    expect(component.isOpen()).toBeTrue();

    component.close();
    expect(component.isOpen()).toBeFalse();
  });

  it('waits for assistant translations before opening the lazy dialog', async () => {
    let resolveTranslations: (() => void) | undefined;
    i18n.loadAssistantTranslations.and.returnValue(
      new Promise<void>((resolve) => {
        resolveTranslations = resolve;
      })
    );
    const component = fixture!.componentInstance;

    const opening = component.open();
    expect(component.isOpen()).toBeFalse();
    expect(resolveTranslations).toBeDefined();

    resolveTranslations?.();
    await opening;

    expect(component.isOpen()).toBeTrue();
  });

  it('keeps closed and reports a toast when translation loading fails', async () => {
    i18n.loadAssistantTranslations.and.returnValue(Promise.reject(new Error('chunk failed')));
    const component = fixture!.componentInstance;

    await component.open();

    expect(component.isOpen()).toBeFalse();
    expect(toast.error).toHaveBeenCalledOnceWith(
      'Error',
      'No se pudo cargar el asistente. Vuelve a intentarlo.'
    );
  });

  it('hides the launcher when the mobile viewport shrinks and restores it after resize', () => {
    const component = fixture!.componentInstance;
    mediaMatches = true;
    viewportHeight = window.innerHeight - 200;
    (resizeListener as EventListener)(new Event('resize'));
    fixture!.detectChanges();

    expect(component.keyboardOpen()).toBeTrue();
    expect(fixture!.nativeElement.querySelector('[data-test="ai-assistant-open"]')).toBeNull();

    viewportHeight = window.innerHeight - 100;
    (resizeListener as EventListener)(new Event('resize'));
    fixture!.detectChanges();

    expect(component.keyboardOpen()).toBeFalse();
    expect(fixture!.nativeElement.querySelector('[data-test="ai-assistant-open"]')).not.toBeNull();
  });

  it('adds only the clearance needed above the rendered household notice', async () => {
    const notice = document.createElement('app-household-planning-automation-notice');
    const disconnectResizeObserver = spyOn(
      ResizeObserver.prototype,
      'disconnect'
    ).and.callThrough();
    const disconnectMutationObserver = spyOn(
      MutationObserver.prototype,
      'disconnect'
    ).and.callThrough();
    const button = fixture!.nativeElement.querySelector(
      '[data-test="ai-assistant-open"]'
    ) as HTMLElement;
    let noticeBounds = new DOMRect(12, 400, 296, 96);
    let buttonBounds = new DOMRect(256, 352, 52, 52);
    spyOn(notice, 'getBoundingClientRect').and.callFake(() => noticeBounds);
    spyOn(button, 'getBoundingClientRect').and.callFake(() => buttonBounds);
    fixture!.nativeElement.parentElement!.append(notice);

    try {
      fixture!.componentRef.setInput('householdId', 'synthetic-household');
      fixture!.detectChanges();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const host = fixture!.nativeElement as HTMLElement;
      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('12px');

      noticeBounds = new DOMRect(12, 390, 296, 106);
      buttonBounds = new DOMRect(256, 340, 52, 52);
      notice.textContent = 'El aviso ahora ocupa más espacio';
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('22px');

      noticeBounds = new DOMRect(12, 400, 0, 0);
      window.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('0px');

      noticeBounds = new DOMRect(12, 400, 296, 96);
      buttonBounds = new DOMRect(256, 352, 52, 52);
      window.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('12px');

      notice.remove();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('0px');

      fixture!.nativeElement.parentElement!.append(notice);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('12px');

      fixture!.componentRef.setInput('householdId', null);
      fixture!.detectChanges();

      expect(host.style.getPropertyValue('--assistant-household-extra-lift')).toBe('0px');
      expect(disconnectResizeObserver).toHaveBeenCalled();
      expect(disconnectMutationObserver).toHaveBeenCalled();

      fixture!.componentRef.setInput('householdId', 'synthetic-household');
      fixture!.detectChanges();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const resizeDisconnectsBeforeDestroy = disconnectResizeObserver.calls.count();
      const mutationDisconnectsBeforeDestroy = disconnectMutationObserver.calls.count();
      fixture!.destroy();
      fixture = null;

      expect(disconnectResizeObserver.calls.count()).toBe(resizeDisconnectsBeforeDestroy + 1);
      expect(disconnectMutationObserver.calls.count()).toBe(mutationDisconnectsBeforeDestroy + 1);
    } finally {
      notice.remove();
    }
  });

  it('does not assume a visual viewport exists and removes its resize listener on destroy', () => {
    const addEventListener = viewport.addEventListener as jasmine.Spy;
    const removeEventListener = viewport.removeEventListener as jasmine.Spy;
    const registeredListener = resizeListener;

    fixture!.destroy();
    fixture = null;

    expect(addEventListener).toHaveBeenCalledOnceWith('resize', registeredListener);
    expect(removeEventListener).toHaveBeenCalledOnceWith('resize', registeredListener);

    Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
    const noViewportFixture = TestBed.createComponent(AiActionAssistantLauncherComponent);
    expect(noViewportFixture.componentInstance.keyboardOpen()).toBeFalse();
    noViewportFixture.destroy();
  });
});
