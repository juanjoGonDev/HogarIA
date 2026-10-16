import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { ModulesService } from '../../core/services/modules.service';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { HouseholdService } from '../../core/services/household.service';
import { of, Subject } from 'rxjs';
import { MainLayoutComponent } from './main-layout.component';

describe('MainLayoutComponent mobile drawer keyboard behavior', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MainLayoutComponent>>;
  let mobileViewport: jasmine.Spy;
  let navigate: jasmine.Spy;
  let routerEvents: Subject<NavigationEnd>;
  let authLogout: jasmine.Spy;
  let currentUser: ReturnType<typeof signal<{ avatar?: string } | null>>;
  let isPathVisible: jasmine.Spy;
  let memberships: ReturnType<typeof signal<any[]>>;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let membershipsFailed: ReturnType<typeof signal<boolean>>;
  let household: ReturnType<typeof signal<any | null>>;

  beforeEach(async () => {
    mobileViewport = spyOn(window, 'matchMedia').and.returnValue({
      matches: true,
      media: '(max-width: 1023px)',
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    } as MediaQueryList);
    routerEvents = new Subject<NavigationEnd>();
    navigate = jasmine.createSpy('navigate').and.callFake(() => {
      routerEvents.next(new NavigationEnd(1, '/account', '/account'));
      return Promise.resolve(true);
    });
    authLogout = jasmine.createSpy('logout');
    currentUser = signal<{ avatar?: string } | null>(null);
    memberships = signal<any[]>([]);
    activeHouseholdId = signal<string | null>(null);
    membershipsFailed = signal(false);
    household = signal<any | null>(null);
    isPathVisible = jasmine
      .createSpy('isPathVisible')
      .and.callFake((path: string) => path !== '/calendar');

    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { userName: signal('Test'), currentUser, logout: authLogout }
        },
        { provide: Router, useValue: { navigate, events: routerEvents } },
        {
          provide: TasteProfileService,
          useValue: { ensureLoaded: jasmine.createSpy('ensureLoaded') }
        },
        {
          provide: HouseholdService,
          useValue: {
            memberships,
            activeHouseholdId,
            membershipsFailed,
            household,
            loadMemberships: jasmine.createSpy('loadMemberships').and.returnValue(of([])),
            ensureHousehold: jasmine.createSpy('ensureHousehold')
          }
        },
        { provide: ModulesService, useValue: { isPathVisible } }
      ]
    })
      .overrideComponent(MainLayoutComponent, {
        set: {
          template: `
            <button type="button" class="header__menu" (click)="toggleSidebar($event)">Menú</button>
            <button type="button" class="sidebar__account-main" (click)="navigateToProfile()">Cuenta</button>
            <div *ngIf="isSidebarOpen()" class="sidebar-overlay"></div>
          `
        }
      })
      .compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    routerEvents?.complete();
    document
      .querySelectorAll('.modal-overlay[data-test="drawer-overlay-test"]')
      .forEach((node) => node.remove());
  });

  function pressEscape(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function createFixture(): HTMLButtonElement {
    fixture = TestBed.createComponent(MainLayoutComponent);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  it('does nothing when the mobile drawer is already closed', () => {
    createFixture();

    pressEscape();

    expect(fixture.componentInstance.isSidebarOpen()).toBeFalse();
  });

  it('closes an open drawer and returns focus to its trigger', () => {
    const trigger = createFixture();
    trigger.focus();
    trigger.click();
    fixture.detectChanges();

    pressEscape();
    fixture.detectChanges();

    expect(fixture.componentInstance.isSidebarOpen()).toBeFalse();
    expect(document.activeElement).toBe(trigger);
  });

  it('locks the page while open and restores pre-existing overflow styles on close', () => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'clip';
    document.documentElement.style.overflow = 'scroll';
    const trigger = createFixture();

    trigger.click();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');
    fixture.componentInstance.closeSidebar();
    expect(document.body.style.overflow).toBe('clip');
    expect(document.documentElement.style.overflow).toBe('scroll');

    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousDocumentOverflow;
  });

  it('returns focus to the trigger when another close path dismisses the drawer', async () => {
    const trigger = createFixture();
    trigger.click();
    fixture.detectChanges();

    const accountButton = fixture.nativeElement.querySelector(
      '.sidebar__account-main'
    ) as HTMLButtonElement;
    accountButton.focus();
    fixture.componentInstance.closeSidebar();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(fixture.componentInstance.isSidebarOpen()).toBeFalse();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus if the drawer reopens before close restores focus', async () => {
    const trigger = createFixture();
    trigger.click();
    fixture.detectChanges();
    const accountButton = fixture.nativeElement.querySelector(
      '.sidebar__account-main'
    ) as HTMLButtonElement;
    accountButton.focus();

    fixture.componentInstance.closeSidebar();
    fixture.componentInstance.isSidebarOpen.set(true);
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.isSidebarOpen()).toBeTrue();
    expect(document.activeElement).toBe(accountButton);
  });

  it('does not restore focus to a trigger removed before the close microtask', async () => {
    const trigger = createFixture();
    trigger.click();
    fixture.detectChanges();
    const accountButton = fixture.nativeElement.querySelector(
      '.sidebar__account-main'
    ) as HTMLButtonElement;

    fixture.componentInstance.closeSidebar();
    trigger.remove();
    accountButton.focus();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.isSidebarOpen()).toBeFalse();
    expect(document.activeElement).toBe(accountButton);
  });

  it('leaves the drawer open when a dialog is above it', () => {
    const trigger = createFixture();
    trigger.click();
    fixture.detectChanges();
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    modalOverlay.dataset['test'] = 'drawer-overlay-test';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    modalOverlay.append(dialog);
    document.body.append(modalOverlay);

    pressEscape();

    expect(fixture.componentInstance.isSidebarOpen()).toBeTrue();
  });

  it('does not let Escape close the fixed desktop sidebar', () => {
    mobileViewport.and.returnValue({
      matches: false,
      media: '(max-width: 1023px)',
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    } as MediaQueryList);
    const trigger = createFixture();
    trigger.click();
    fixture.detectChanges();

    pressEscape();

    expect(fixture.componentInstance.isSidebarOpen()).toBeTrue();
  });

  it('closes the mobile drawer when navigating to the account profile', async () => {
    const trigger = createFixture();
    trigger.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isSidebarOpen()).toBeTrue();

    const accountButton = fixture.nativeElement.querySelector(
      '.sidebar__account-main'
    ) as HTMLButtonElement;
    accountButton.focus();
    accountButton.click();
    fixture.detectChanges();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(navigate).toHaveBeenCalledWith(['/account']);
    expect(fixture.componentInstance.isSidebarOpen()).toBeFalse();
    expect(document.activeElement).toBe(trigger);
    expect(fixture.nativeElement.querySelector('.sidebar-overlay')).toBeNull();
  });

  it('filters the shared sidebar links using the enabled modules', () => {
    createFixture();
    const component = fixture.componentInstance;

    const desktopPaths = component.visibleNavItems().map((item) => item.path);

    expect(desktopPaths).toContain('/dashboard');
    expect(desktopPaths).not.toContain('/calendar');
    expect(isPathVisible).toHaveBeenCalledWith('/calendar');
  });

  it('shows AI settings only in personal mode or for an active household settings manager', () => {
    createFixture();
    const component = fixture.componentInstance;
    const aiPathVisible = () =>
      component.visibleNavItems().some((item) => item.path === '/ai-config');

    expect(aiPathVisible()).toBeTrue();
    memberships.set([
      {
        id: 'home-a',
        permissions: { settings: false }
      }
    ]);
    activeHouseholdId.set('home-a');
    expect(aiPathVisible()).toBeFalse();

    memberships.set([
      {
        id: 'home-a',
        permissions: { settings: true }
      }
    ]);
    expect(aiPathVisible()).toBeTrue();

    activeHouseholdId.set(null);
    expect(aiPathVisible()).toBeFalse();
    membershipsFailed.set(true);
    memberships.set([]);
    expect(aiPathVisible()).toBeFalse();
  });

  it('enables planning actions only for the active household and its matching permission', () => {
    createFixture();
    const component = fixture.componentInstance;

    expect(component.canManagePlanningAutomation()).toBeFalse();
    expect(component.canActivatePlanningAutomation()).toBeFalse();

    household.set({
      id: 'home-a',
      myRole: 'member',
      myPermissions: { settings: false, calendar: { edit: false } }
    });
    activeHouseholdId.set('home-b');
    expect(component.canManagePlanningAutomation()).toBeFalse();
    expect(component.canActivatePlanningAutomation()).toBeFalse();

    activeHouseholdId.set('home-a');
    expect(component.canManagePlanningAutomation()).toBeFalse();
    expect(component.canActivatePlanningAutomation()).toBeFalse();

    household.set({
      id: 'home-a',
      myRole: 'member',
      myPermissions: { settings: true, calendar: { edit: true } }
    });
    expect(component.canManagePlanningAutomation()).toBeTrue();
    expect(component.canActivatePlanningAutomation()).toBeTrue();

    household.set({ id: 'home-a', myRole: 'admin', myPermissions: {} });
    expect(component.canManagePlanningAutomation()).toBeTrue();
    expect(component.canActivatePlanningAutomation()).toBeTrue();
  });

  it('returns the current avatar and logs out through the auth service', () => {
    createFixture();
    expect(fixture.componentInstance.userAvatar()).toBeUndefined();
    currentUser.set({ avatar: 'avatar-data' });

    expect(fixture.componentInstance.userAvatar()).toBe('avatar-data');
    fixture.componentInstance.logout();

    expect(authLogout).toHaveBeenCalledTimes(1);
  });
});
