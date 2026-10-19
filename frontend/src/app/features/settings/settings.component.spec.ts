import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { SettingsComponent } from './settings.component';
import { I18nService } from '../../core/services/i18n.service';
import { ModulesService } from '../../core/services/modules.service';
import { ThemeService } from '../../core/services/theme.service';
import { DashboardPreferencesService } from '../../core/services/dashboard-preferences.service';
import type { Language } from '../../core/services/i18n.service';
import type { Theme } from '../../core/services/theme.service';

describe('SettingsComponent', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let theme: {
    theme: WritableSignal<Theme>;
    isDark: WritableSignal<boolean>;
    setTheme: jasmine.Spy;
  };
  let i18n: {
    lang: WritableSignal<Language>;
    changeTick: WritableSignal<number>;
    t: (key: string) => string;
    setLang: jasmine.Spy;
  };
  let modules: {
    registry: Array<{ id: string; available: boolean; labelKey: string; hintKey: string }>;
    isSaving: WritableSignal<boolean>;
    profileLoaded: WritableSignal<boolean>;
    profileLoading: WritableSignal<boolean>;
    lastError: WritableSignal<string | null>;
    selected: WritableSignal<string[]>;
    isEnabled: jasmine.Spy;
    canSwitchOff: jasmine.Spy;
    toggle: jasmine.Spy;
    resetSelection: jasmine.Spy;
  };
  let dashboardPreferences: {
    expiryHorizonDays: WritableSignal<number>;
    setExpiryHorizonDays: jasmine.Spy;
  };

  beforeEach(async () => {
    theme = {
      theme: signal<Theme>('light'),
      isDark: signal(false),
      setTheme: jasmine.createSpy('setTheme').and.callFake((value: Theme) => theme.theme.set(value))
    };
    i18n = {
      lang: signal<Language>('es'),
      changeTick: signal(0),
      t: (key: string) => key,
      setLang: jasmine.createSpy('setLang').and.callFake((value: Language) => i18n.lang.set(value))
    };
    modules = {
      registry: [
        {
          id: 'meals',
          available: true,
          labelKey: 'settings.modules.meals',
          hintKey: 'settings.modules.meals.hint'
        }
      ],
      isSaving: signal(false),
      profileLoaded: signal(true),
      profileLoading: signal(false),
      lastError: signal<string | null>(null),
      selected: signal<string[]>(['meals']),
      isEnabled: jasmine.createSpy('isEnabled').and.returnValue(true),
      canSwitchOff: jasmine.createSpy('canSwitchOff').and.returnValue(true),
      toggle: jasmine.createSpy('toggle'),
      resetSelection: jasmine.createSpy('resetSelection')
    };
    dashboardPreferences = {
      expiryHorizonDays: signal(3),
      setExpiryHorizonDays: jasmine
        .createSpy('setExpiryHorizonDays')
        .and.callFake((value: unknown) => {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 30) {
            return false;
          }
          dashboardPreferences.expiryHorizonDays.set(value);
          return true;
        })
    };

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: ThemeService, useValue: theme },
        { provide: I18nService, useValue: i18n },
        { provide: ModulesService, useValue: modules },
        { provide: DashboardPreferencesService, useValue: dashboardPreferences }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
  });

  it('exposes selected theme and language as pressed buttons and applies changes', () => {
    const themeButtons = fixture.nativeElement.querySelectorAll(
      '.settings-group:nth-of-type(1) .settings-option'
    ) as NodeListOf<HTMLButtonElement>;
    const darkButton = Array.from(
      fixture.nativeElement.querySelectorAll('.settings-option') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.includes('settings.theme.dark')) as HTMLButtonElement;
    expect(darkButton.getAttribute('aria-pressed')).toBe('false');
    darkButton.click();
    fixture.detectChanges();
    expect(theme.setTheme).toHaveBeenCalledWith('dark');
    expect(darkButton.getAttribute('aria-pressed')).toBe('true');

    const englishButton = fixture.nativeElement.querySelector(
      '[data-test="settings-lang-en"]'
    ) as HTMLButtonElement;
    expect(englishButton.getAttribute('aria-pressed')).toBe('false');
    englishButton.click();
    fixture.detectChanges();
    expect(i18n.setLang).toHaveBeenCalledWith('en');
    expect(englishButton.getAttribute('aria-pressed')).toBe('true');
    expect(themeButtons.length).toBe(3);
  });

  it('exposes the expiry horizon as an accessible bounded setting and rejects invalid edits', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      '#settings-expiry-horizon-days'
    ) as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('30');
    expect(input.value).toBe('3');
    expect(input.labels?.length).toBe(1);
    expect(input.getAttribute('aria-describedby')).toBe('settings-expiry-horizon-days-helper');

    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dashboardPreferences.setExpiryHorizonDays).toHaveBeenCalledWith(5);
    expect(input.value).toBe('5');
    expect(dashboardPreferences.expiryHorizonDays()).toBe(5);

    input.value = '31';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dashboardPreferences.setExpiryHorizonDays).toHaveBeenCalledWith(31);
    expect(input.value).toBe('31');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('#settings-expiry-horizon-days-error')
    ).not.toBeNull();
  });

  it('keeps module reset disabled while saving and exposes failures as an alert', () => {
    const reset = fixture.nativeElement.querySelector('[data-modules-reset]') as HTMLButtonElement;
    expect(reset).not.toBeNull();
    modules.isSaving.set(true);
    fixture.detectChanges();
    expect(reset.disabled).toBeTrue();

    modules.isSaving.set(false);
    fixture.detectChanges();
    reset.click();
    expect(modules.resetSelection).toHaveBeenCalled();

    modules.lastError.set('MODULE_SAVE_FAILED');
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('.settings-hint--error') as HTMLElement;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.getAttribute('aria-atomic')).toBe('true');
  });

  it('routes module toggles through the service and renders the semantic switch state', () => {
    const toggle = fixture.nativeElement.querySelector(
      '[data-module-switch="meals"]'
    ) as HTMLElement;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-labelledby')).toBe('settings-module-label-meals');
    expect(toggle.getAttribute('aria-describedby')).toBe('settings-module-hint-meals');

    modules.isSaving.set(true);
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.getAttribute('tabindex')).toBe('0');
    toggle.click();
    expect(modules.toggle).not.toHaveBeenCalled();

    modules.isSaving.set(false);
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-disabled')).toBe('false');
    toggle.click();
    expect(modules.toggle).toHaveBeenCalledWith('meals');
  });

  it('keeps the last enabled module semantically disabled', () => {
    modules.canSwitchOff.and.returnValue(false);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-module-switch="meals"]'
    ) as HTMLElement;
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.getAttribute('tabindex')).toBe('-1');
    toggle.click();
    expect(modules.toggle).not.toHaveBeenCalled();
  });

  it('disables module controls until the profile is ready', () => {
    modules.profileLoaded.set(false);
    modules.profileLoading.set(true);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '[data-module-switch="meals"]'
    ) as HTMLElement;
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(toggle.getAttribute('tabindex')).toBe('-1');

    fixture.componentInstance.toggleModule('meals');
    expect(modules.toggle).not.toHaveBeenCalled();

    // Si la carga falla (deja de estar pendiente), el control no queda bloqueado para siempre.
    modules.profileLoading.set(false);
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-disabled')).toBe('false');
    expect(toggle.getAttribute('tabindex')).toBe('0');
  });
});
