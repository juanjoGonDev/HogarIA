import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { STORAGE_KEYS } from './storage.service';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('setTheme', () => {
    it('should set light theme', () => {
      service.setTheme('light');

      expect(service.theme()).toBe('light');
      expect(service.isDark()).toBeFalse();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('should set dark theme', () => {
      service.setTheme('dark');

      expect(service.theme()).toBe('dark');
      expect(service.isDark()).toBeTrue();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should save theme to localStorage', () => {
      service.setTheme('dark');

      expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark');
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from light to dark', () => {
      service.setTheme('light');
      service.toggleTheme();

      expect(service.theme()).toBe('dark');
    });

    it('should toggle from dark to light', () => {
      service.setTheme('dark');
      service.toggleTheme();

      expect(service.theme()).toBe('light');
    });
  });

  describe('system theme', () => {
    it('should use system preference when theme is system', () => {
      service.setTheme('system');

      expect(service.theme()).toBe('system');
    });
  });

  describe('initialization', () => {
    it('should load theme from localStorage', () => {
      localStorage.setItem(STORAGE_KEYS.theme, 'dark');

      // Create new instance to test initialization
      const newService = TestBed.runInInjectionContext(() => new ThemeService());

      expect(newService.theme()).toBe('dark');
    });

    it('should default to system if no stored theme', () => {
      const newService = TestBed.runInInjectionContext(() => new ThemeService());

      expect(newService.theme()).toBe('system');
    });

    it('should ignore an unknown stored theme', () => {
      localStorage.setItem(STORAGE_KEYS.theme, 'sepia');

      const newService = TestBed.runInInjectionContext(() => new ThemeService());

      expect(newService.theme()).toBe('system');
    });

    it('should follow system color changes only while the system theme is selected', () => {
      const listeners: EventListenerOrEventListenerObject[] = [];
      const queryState = { matches: false };
      const mediaQuery = {
        get matches() {
          return queryState.matches;
        },
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.push(listener)
      } as unknown as MediaQueryList;
      spyOn(window, 'matchMedia').and.returnValue(mediaQuery);

      const systemService = TestBed.runInInjectionContext(() => new ThemeService());
      expect(systemService.theme()).toBe('system');
      expect(systemService.isDark()).toBeFalse();
      expect(listeners.length).toBe(1);

      queryState.matches = true;
      (listeners[0] as EventListener)(new Event('change'));
      expect(systemService.isDark()).toBeTrue();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      systemService.setTheme('light');
      queryState.matches = false;
      (listeners[0] as EventListener)(new Event('change'));
      expect(systemService.isDark()).toBeFalse();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
});
