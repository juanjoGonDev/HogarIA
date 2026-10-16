import {
  Component,
  computed,
  HostListener,
  OnDestroy,
  OnInit,
  NgZone,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ModulesService } from '../../core/services/modules.service';
import { ToastComponent } from '../../shared/components/ui/toast/toast.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import { IconButtonComponent } from '../../shared/components/ui/icon-button/icon-button.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ConfirmDialogComponent } from '../../shared/components/ui/confirm-dialog/confirm-dialog.component';
import { ReceiptQueueComponent } from '../../shared/components/receipts/receipt-queue.component';
import { PageContainerComponent } from '../../shared/components/page-container/page-container.component';
import { HouseholdSwitcherComponent } from '../../shared/components/household-switcher.component';
import { HouseholdPlanningAutomationNoticeComponent } from '../../shared/components/household-planning-automation-notice.component';
import { AiActionAssistantLauncherComponent } from '../../shared/components/ai-action-assistant-launcher.component';
import { HouseholdService } from '../../core/services/household.service';
import type { DrawerGestureSource } from './mobile-drawer-gesture.controller';
import type { TranslationKey } from '../../core/i18n';

interface NavItem {
  path: string;
  labelKey: TranslationKey;
  /**
   * Nombre del set de iconos (`assets/icons` / `icon-paths.ts`), nunca un emoji: los glifos
   * del sistema salen distintos en cada SO y cada fabrica —en el movil de la captura el de la
   * IA se veia como una cajita—.
   */
  icon: IconName;
}

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToastComponent,
    AvatarComponent,
    IconComponent,
    IconButtonComponent,
    TranslatePipe,
    ConfirmDialogComponent,
    ReceiptQueueComponent,
    PageContainerComponent,
    HouseholdSwitcherComponent,
    HouseholdPlanningAutomationNoticeComponent,
    AiActionAssistantLauncherComponent
  ],
  template: `
    <div class="layout">
      <!-- Mobile Header -->
      <header class="header" [attr.inert]="isDrawerModal() ? '' : null">
        <button
          type="button"
          class="header__menu"
          aria-controls="primary-sidebar"
          [attr.aria-expanded]="isSidebarOpen()"
          [attr.aria-label]="(isSidebarOpen() ? 'ui.close_menu' : 'ui.open_menu') | t"
          (click)="toggleSidebar($event)"
        >
          <app-icon
            [name]="isSidebarOpen() ? 'close' : 'menu'"
            [size]="24"
            [label]="isSidebarOpen() ? ('ui.close_menu' | t) : ('ui.open_menu' | t)"
          />
        </button>
        <span class="header__title">
          <app-icon name="home" [size]="20" [label]="null" />
          <span class="header__title-text">{{ 'app.name' | t }}</span>
        </span>
        <!-- La cola de lectura de tickets: gira mientras la IA local lee, rojo si algo
             fallo, y su clic enseña el progreso y los frenos (## 12aj). -->
        <app-receipt-queue *ngIf="hasActiveHousehold()" class="header__queue" />
        <button type="button" class="header__profile" (click)="navigateToProfile()">
          <!-- La foto tambien aqui: era el unico avatar de la app que ignoraba la
               URL del usuario, asi que en el movil se veia la inicial aunque la
               persona tuviera foto en el sidebar. -->
          <app-avatar [name]="authService.userName()" [src]="userAvatar()" size="sm"></app-avatar>
        </button>
      </header>

      <!-- Sidebar (Desktop) -->
      <aside
        id="primary-sidebar"
        class="sidebar"
        [class.sidebar--open]="isSidebarOpen()"
        [class.sidebar--dragging]="isDrawerDragging()"
        [attr.role]="isDrawerModal() ? 'dialog' : null"
        [attr.aria-modal]="isDrawerModal() ? 'true' : null"
        [attr.aria-labelledby]="isDrawerModal() ? 'primary-sidebar-title' : null"
        [attr.aria-hidden]="isMobileViewport() && !isSidebarOpen() ? 'true' : null"
        [attr.inert]="isMobileViewport() && !isSidebarOpen() ? '' : null"
        (click.capture)="suppressGestureClick($event)"
      >
        <div class="sidebar__header">
          <button
            type="button"
            class="sidebar__close"
            [attr.aria-label]="'ui.close_menu' | t"
            (click)="closeSidebar()"
          >
            <app-icon name="close" [size]="20" [label]="'ui.close_menu' | t" />
          </button>
          <span class="sidebar__logo">
            <app-icon name="home" [size]="20" [label]="null" />
            <span id="primary-sidebar-title">{{ 'app.name' | t }}</span>
          </span>
          <app-receipt-queue *ngIf="hasActiveHousehold()" class="sidebar__receipt-queue" />
        </div>

        <app-household-switcher />

        <nav class="sidebar__nav">
          <a
            *ngFor="let item of visibleNavItems()"
            [routerLink]="item.path"
            routerLinkActive="sidebar__item--active"
            ariaCurrentWhenActive="page"
            class="sidebar__item"
            (click)="closeSidebar(true)"
          >
            <app-icon class="sidebar__icon" [name]="item.icon" [size]="20" [label]="null" />
            <span class="sidebar__label">{{ item.labelKey | t }}</span>
          </a>
        </nav>

        <div class="sidebar__footer">
          <a
            routerLink="/settings"
            routerLinkActive="sidebar__item--active"
            ariaCurrentWhenActive="page"
            class="sidebar__item"
            (click)="closeSidebar(true)"
          >
            <app-icon class="sidebar__icon" name="settings" [size]="20" [label]="null" />
            <span class="sidebar__label">{{ 'nav.settings' | t }}</span>
          </a>

          <!-- Abajo a la izquierda, la PERSONA y no una fila de «Cerrar sesion»: su foto (o su
               inicial, si aun no la tiene) y su nombre, con el boton de salir aparte y pequeno.
               Cerrar sesion era una fila mas del menu, del mismo tamano que «Inicio», y se
               tocaba solo; y quien usa la app no veia con que cuenta estaba. -->
          <div class="sidebar__account" data-test="account-chip">
            <button type="button" class="sidebar__account-main" (click)="navigateToProfile()">
              <app-avatar [name]="authService.userName()" [src]="userAvatar()" size="sm" />
              <span class="sidebar__account-name">{{
                authService.userName() || ('nav.guest' | t)
              }}</span>
            </button>
            <app-icon-button
              icon="logout"
              size="sm"
              variant="ghost"
              [label]="'nav.logout' | t"
              data-test="logout"
              (onClick)="logout()"
            />
          </div>
        </div>
      </aside>

      <!-- Overlay for mobile sidebar -->
      <button
        *ngIf="isMobileViewport()"
        type="button"
        class="sidebar-overlay"
        tabindex="-1"
        [attr.aria-label]="'ui.close_menu' | t"
        [class.sidebar-overlay--visible]="isSidebarOpen() || isDrawerDragging()"
        [class.sidebar-overlay--dragging]="isDrawerDragging()"
        (click.capture)="suppressGestureClick($event)"
        (click)="closeSidebar()"
      ></button>

      <div
        *ngIf="isMobileViewport() && !isSidebarOpen()"
        class="sidebar-edge-sensor"
        aria-hidden="true"
        [attr.data-gesture-ready]="isDrawerGestureReady() ? 'true' : 'false'"
      ></div>

      <!-- Main Content -->
      <main class="main" [attr.inert]="isDrawerModal() ? '' : null">
        <app-page-container [bounded]="true">
          <router-outlet></router-outlet>
        </app-page-container>
      </main>
    </div>

    <app-household-planning-automation-notice
      *ngIf="activeHouseholdId() as planningHouseholdId"
      [householdId]="planningHouseholdId"
      [canManage]="canManagePlanningAutomation()"
      [canActivate]="canActivatePlanningAutomation()"
    />

    <app-ai-action-assistant-launcher [householdId]="activeHouseholdId()" />

    <app-toast></app-toast>
    <app-confirm-dialog></app-confirm-dialog>
  `,
  styles: [
    `
      /*
     * ── Estados de interaccion (HOGARIA-SPEC 12q-B) ───────────────────────────────────────────
     *
     * Todo lo que se pulsa avisa antes de que se pulse. Va aqui arriba, junto, en lugar de repartido por
     * las reglas de cada control: asi la proxima clase que se anada se compara con esta lista, y el
     * check-ui (regla boton-sin-afecto) no deja a nadie poner un boton sin su hover. Van sin :hover los
     * deshabilitados —un boton apagado que se ilumina es la manera mas rapida de ensenar a desconfiar.
     */
      /* LaX de cerrar el cajon y la fila de la cuenta: las dos estan sobre fondo de panel, asi que su
       respuesta es un circulo mas claro, no un color de accion. */
      .sidebar__close:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      .sidebar__account-main:hover {
        background: var(--bg-tertiary);
      }

      .layout {
        min-height: 100vh;
        background: var(--bg-primary);
      }

      :host {
        --app-mobile-header-height: 56px;
      }

      /* Header */
      .header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--app-mobile-header-height);
        padding: 0 var(--space-4);
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-default);
        gap: var(--space-2);

        @media (min-width: 1024px) {
          display: none;
        }
      }

      .header__menu,
      .header__profile {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-lg);
        background: none;
        border: none;
        cursor: pointer;
        font-size: var(--text-xl);
        color: var(--text-primary);
        transition: var(--transition-fast);

        &:hover {
          background: var(--bg-tertiary);
        }
      }

      .header__title {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        /* La marca del layout va en la cabecera de arriba: el nombre, y el icono de la casa. */
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-bold);
        color: var(--primary);
        min-width: 0;
      }

      .header__title-text {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      /* Sidebar */
      .sidebar {
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        z-index: 200;
        width: 280px;
        background: var(--bg-secondary);
        border-right: 1px solid var(--border-default);
        display: flex;
        flex-direction: column;
        transform: translateX(-100%);
        transition: transform var(--duration-300) var(--ease-out);
        touch-action: pan-y;
        overscroll-behavior-x: contain;

        @media (min-width: 1024px) {
          transform: translateX(0);
        }
      }

      .sidebar--open {
        transform: translateX(0);
      }

      .sidebar--dragging {
        transition: none !important;
      }

      .sidebar__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: var(--space-4);
        border-bottom: 1px solid var(--border-default);
      }

      .sidebar__logo {
        order: 0;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        color: var(--primary);
      }

      .sidebar__close {
        order: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-md);
        background: none;
        border: none;
        cursor: pointer;
        font-size: var(--text-lg);
        color: var(--text-tertiary);

        @media (min-width: 1024px) {
          display: none;
        }
      }

      .sidebar__receipt-queue {
        order: 1;
        margin-left: auto;
      }

      .sidebar__nav {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-4);
      }

      .sidebar__item {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        margin-bottom: var(--space-1);
        color: var(--text-secondary);
        text-decoration: none;
        border-radius: var(--radius-lg);
        transition: var(--transition-fast);
        cursor: pointer;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        font-size: var(--text-sm);

        &:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
      }

      .sidebar__item--active {
        background: var(--primary-subtle);
        color: var(--primary-dark);
        font-weight: var(--font-medium);
      }

      .sidebar__item--logout {
        color: var(--error);

        &:hover {
          background: var(--error-subtle);
        }
      }

      .sidebar__icon {
        font-size: var(--text-lg);
        width: 24px;
        text-align: center;
      }

      .sidebar__footer {
        padding: var(--space-4);
        border-top: 1px solid var(--border-default);
      }

      /* El chip de cuenta: la persona a la izquierda, y el cerrar sesion pequeno a su lado. */
      .sidebar__account {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        margin-top: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-lg);
        transition: var(--transition-fast);

        &:hover {
          background: var(--bg-tertiary);
        }
      }

      .sidebar__account-main {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .sidebar__account-name {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
      }

      /* En el drawer del movil el nombre no cabe y no hace falta: el avatar ya es la persona. */
      @media (max-width: 1023px) {
        .sidebar__account-name {
          display: none;
        }
      }

      /* Sidebar Overlay */
      .sidebar-overlay {
        position: fixed;
        inset: 0;
        z-index: 150;
        width: 100%;
        padding: 0;
        border: 0;
        background: rgba(0, 0, 0, 0.5);
        cursor: pointer;
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
        touch-action: pan-y;
        overscroll-behavior-x: contain;
        transition: opacity var(--duration-200) var(--ease-out);

        &:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: -3px;
        }

        @media (min-width: 1024px) {
          display: none;
        }
      }

      .sidebar-overlay--visible {
        visibility: visible;
        opacity: 1;
        pointer-events: auto;
      }

      .sidebar-edge-sensor {
        position: fixed;
        inset: 0 auto 0 0;
        z-index: 149;
        width: 16px;
        touch-action: pan-y;
        overscroll-behavior-x: contain;
      }

      /* Main Content */
      .main {
        padding-top: 56px;
        padding-bottom: 0;
        min-height: 100vh;

        @media (min-width: 1024px) {
          margin-left: 280px;
          padding-top: 0;
          padding-bottom: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .sidebar,
        .sidebar-overlay {
          transition-duration: 0.01ms;
        }
      }
    `
  ]
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly householdService = inject(HouseholdService);
  private readonly modules = inject(ModulesService);
  private readonly zone = inject(NgZone);
  private sidebarTrigger: HTMLElement | null = null;
  private drawerGestureController:
    import('./mobile-drawer-gesture.controller').MobileDrawerGestureController | null = null;
  private drawerGestureControllerLoad: Promise<void> | null = null;
  private destroyed = false;
  private bodyOverflowBeforeLock: string | null = null;
  private documentOverflowBeforeLock: string | null = null;
  private readonly viewportQuery = window.matchMedia('(max-width: 1023px)');
  private readonly onViewportChange = (event: MediaQueryListEvent): void => {
    this.isMobileViewport.set(event.matches);
    if (event.matches) {
      this.ensureDrawerGestureController();
    } else {
      const wasOpen = this.isSidebarOpen();
      this.sidebarTrigger = null;
      this.closeSidebar();
      if (wasOpen) {
        window.setTimeout(() => {
          this.sidebarElement()
            ?.querySelector<HTMLElement>('.sidebar__nav a[aria-current="page"]')
            ?.focus();
        }, 0);
      }
    }
  };
  isSidebarOpen = signal(false);
  readonly isMobileViewport = signal(this.viewportQuery.matches);
  readonly isDrawerDragging = signal(false);
  readonly isDrawerGestureReady = signal(false);
  readonly isDrawerModal = computed(() => this.isMobileViewport() && this.isSidebarOpen());

  ngOnInit(): void {
    this.viewportQuery.addEventListener('change', this.onViewportChange);
    if (this.isMobileViewport()) this.ensureDrawerGestureController();
    this.householdService
      .loadMemberships()
      .subscribe(() => this.householdService.ensureHousehold());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.viewportQuery.removeEventListener('change', this.onViewportChange);
    this.drawerGestureController?.destroy();
    this.drawerGestureController = null;
    this.cancelGesture();
    this.unlockBodyScroll();
  }

  navItems: NavItem[] = [
    { path: '/dashboard', labelKey: 'nav.dashboard', icon: 'home' },
    { path: '/pantry', labelKey: 'nav.pantry', icon: 'inventory_2' },
    { path: '/recipes', labelKey: 'nav.recipes', icon: 'menu_book' },
    { path: '/calendar', labelKey: 'nav.calendar', icon: 'calendar_today' },
    { path: '/shopping', labelKey: 'nav.shopping', icon: 'shopping_cart' },
    { path: '/receipts', labelKey: 'nav.receipts', icon: 'receipt_long' },
    { path: '/household', labelKey: 'nav.household', icon: 'group' },
    { path: '/preferences', labelKey: 'nav.preferences', icon: 'person' },
    { path: '/ai-config', labelKey: 'nav.ai-config', icon: 'smart_toy' },
    { path: '/logs', labelKey: 'nav.logs', icon: 'description' }
  ];

  /** La foto de la persona, si la tiene; si no, `app-avatar` saca la inicial del nombre. */
  readonly userAvatar = computed(() => this.authService.currentUser()?.avatar || undefined);

  /** La cola está asociada al hogar y no debe consultar datos antes de pertenecer a uno. */
  readonly hasActiveHousehold = computed(() => Boolean(this.householdService.activeHouseholdId()));
  readonly activeHouseholdId = computed(() => this.householdService.activeHouseholdId());
  readonly canManagePlanningAutomation = computed(() => {
    const household = this.householdService.household();
    return Boolean(
      household &&
      household.id === this.householdService.activeHouseholdId() &&
      (household.myPermissions?.settings ?? household.myRole === 'admin')
    );
  });
  readonly canActivatePlanningAutomation = computed(() => {
    const household = this.householdService.household();
    return Boolean(
      household &&
      household.id === this.householdService.activeHouseholdId() &&
      (household.myPermissions?.calendar?.edit ?? household.myRole === 'admin')
    );
  });

  /** Personal mode stays available; inside a home, configuration requires that home's settings permission. */
  readonly canManageAiSettings = computed(() => {
    if (this.householdService.membershipsFailed()) return false;
    const memberships = this.householdService.memberships();
    if (memberships.length === 0) return true;
    const activeId = this.householdService.activeHouseholdId();
    return memberships.some(
      (membership) => membership.id === activeId && membership.permissions?.settings === true
    );
  });

  /**
   * La navegacion deriva de los modulos: al activar o apagar uno en
   * Configuracion se repinta sola, sin recargar la pagina.
   */
  readonly visibleNavItems = computed(() =>
    this.navItems.filter(
      (item) =>
        this.modules.isPathVisible(item.path) &&
        (item.path !== '/ai-config' || this.canManageAiSettings())
    )
  );
  toggleSidebar(event: MouseEvent): void {
    const opening = !this.isSidebarOpen();
    if (opening) {
      this.openSidebar(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
    } else {
      this.closeSidebar();
    }
  }

  closeSidebar(waitForNavigation = false): void {
    this.cancelGesture();
    this.isSidebarOpen.set(false);
    this.unlockBodyScroll();
    const trigger = this.sidebarTrigger;
    this.sidebarTrigger = null;
    if (!trigger) return;

    const restoreFocus = () => {
      window.setTimeout(() => {
        if (!this.isSidebarOpen() && trigger.isConnected) trigger.focus();
      }, 0);
    };
    if (waitForNavigation) {
      // The route outlet can change after the link click and reset document focus.
      // Restore after NavigationEnd; timeout only covers cancelled/guarded navigation.
      let timeout: number | null = null;
      let subscription: { unsubscribe(): void } | null = null;
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        if (timeout !== null) window.clearTimeout(timeout);
        subscription?.unsubscribe();
        restoreFocus();
      };
      timeout = window.setTimeout(finish, 750);
      subscription = this.router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) finish();
      });
    } else {
      restoreFocus();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (
      !this.isSidebarOpen() ||
      !window.matchMedia('(max-width: 1023px)').matches ||
      document.querySelector('.modal-overlay [role="dialog"]')
    ) {
      return;
    }

    event.preventDefault();
    const trigger = this.sidebarTrigger;
    this.closeSidebar();
    if (trigger?.isConnected) trigger.focus();
  }

  @HostListener('document:keydown', ['$event'])
  onDrawerTabKey(event: KeyboardEvent): void {
    if (!this.isDrawerModal() || event.key !== 'Tab') return;
    const focusable = this.drawerFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !this.sidebarContainsFocus())) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !this.sidebarContainsFocus())
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  @HostListener('document:focusin', ['$event'])
  onDrawerFocusIn(event: FocusEvent): void {
    if (this.isDrawerModal() && !this.sidebarElement()?.contains(event.target as Node)) {
      this.drawerFocusableElements()[0]?.focus();
    }
  }

  suppressGestureClick(event: Event): void {
    this.drawerGestureController?.suppressGestureClick(event);
  }

  navigateToProfile(): void {
    // El avatar habla de la persona, y desde la ronda 13 tiene pagina propia: /account (nombre,
    // foto, contrasena). Preferencias es del comensal —gustos, alergias, objetivo— y Configuracion
    // de la app (tema, idioma, modulos): tres preguntas distintas, tres sitios.
    this.closeSidebar(true);
    this.router.navigate(['/account']);
  }

  logout(): void {
    this.authService.logout();
  }

  private openSidebar(trigger: HTMLElement | null): void {
    this.cancelGesture();
    const overlay = this.overlayElement();
    if (overlay) {
      overlay.style.opacity = '';
      overlay.style.transition = '';
    }
    this.sidebarTrigger = trigger ?? this.sidebarTrigger ?? document.querySelector('.header__menu');
    this.isSidebarOpen.set(true);
    if (!this.isMobileViewport()) return;
    this.lockBodyScroll();
    window.setTimeout(
      () =>
        window.requestAnimationFrame(() => {
          if (this.isDrawerModal()) this.drawerFocusableElements()[0]?.focus();
        }),
      0
    );
  }

  private ensureDrawerGestureController(): void {
    if (this.drawerGestureController || this.drawerGestureControllerLoad) return;
    this.drawerGestureControllerLoad = import('./mobile-drawer-gesture.controller')
      .then(({ MobileDrawerGestureController }) => {
        const controller = this.zone.runOutsideAngular(
          () =>
            new MobileDrawerGestureController({
              isMobileViewport: () => this.isMobileViewport(),
              isOpen: () => this.isSidebarOpen(),
              sidebarElement: () => this.sidebarElement(),
              overlayElement: () => this.overlayElement(),
              onDragging: (dragging) => this.zone.run(() => this.isDrawerDragging.set(dragging)),
              onSettle: (open, source) =>
                this.zone.run(() => this.settleDrawerGesture(open, source))
            })
        );
        if (this.destroyed) {
          controller.destroy();
          return;
        }
        this.drawerGestureController = controller;
        this.zone.run(() => this.isDrawerGestureReady.set(true));
      })
      .catch((error: unknown) => {
        this.drawerGestureControllerLoad = null;
        console.error('Mobile drawer gestures failed to load', error);
      });
  }

  private settleDrawerGesture(open: boolean, source: DrawerGestureSource): void {
    this.isDrawerDragging.set(false);
    if (open) {
      if (source === 'edge') this.sidebarTrigger = document.querySelector('.header__menu');
      this.isSidebarOpen.set(true);
      this.lockBodyScroll();
      window.setTimeout(
        () =>
          window.requestAnimationFrame(() => {
            if (this.isDrawerModal()) this.drawerFocusableElements()[0]?.focus();
          }),
        0
      );
      return;
    }

    this.isSidebarOpen.set(false);
    this.unlockBodyScroll();
    const trigger = this.sidebarTrigger;
    this.sidebarTrigger = null;
    window.setTimeout(() => {
      if (!this.isSidebarOpen() && trigger?.isConnected) trigger.focus();
    }, 0);
  }

  private cancelGesture(): void {
    this.drawerGestureController?.cancel();
    this.isDrawerDragging.set(false);
    const sidebar = this.sidebarElement();
    if (sidebar) {
      sidebar.style.transform = '';
      sidebar.style.transition = '';
    }
  }
  private sidebarElement(): HTMLElement | null {
    return document.getElementById('primary-sidebar');
  }

  private overlayElement(): HTMLElement | null {
    return document.querySelector('.sidebar-overlay');
  }

  private drawerFocusableElements(): HTMLElement[] {
    return Array.from(
      this.sidebarElement()?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('inert'));
  }

  private sidebarContainsFocus(): boolean {
    return Boolean(this.sidebarElement()?.contains(document.activeElement));
  }

  private lockBodyScroll(): void {
    if (this.bodyOverflowBeforeLock !== null) return;
    this.bodyOverflowBeforeLock = document.body.style.overflow;
    this.documentOverflowBeforeLock = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    if (this.bodyOverflowBeforeLock === null || this.documentOverflowBeforeLock === null) return;
    document.body.style.overflow = this.bodyOverflowBeforeLock;
    document.documentElement.style.overflow = this.documentOverflowBeforeLock;
    this.bodyOverflowBeforeLock = null;
    this.documentOverflowBeforeLock = null;
  }
}
