import { Component, computed, HostListener, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
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
import { HouseholdService } from '../../core/services/household.service';
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
    HouseholdPlanningAutomationNoticeComponent
  ],
  template: `
    <div class="layout">
      <!-- Mobile Header -->
      <header class="header">
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
      <aside id="primary-sidebar" class="sidebar" [class.sidebar--open]="isSidebarOpen()">
        <div class="sidebar__header">
          <span class="sidebar__logo">
            <app-icon name="home" [size]="20" [label]="null" />
            <span>{{ 'app.name' | t }}</span>
          </span>
          <app-receipt-queue *ngIf="hasActiveHousehold()" />
          <button type="button" class="sidebar__close" (click)="closeSidebar()">
            <app-icon name="close" [size]="20" [label]="'ui.close_menu' | t" />
          </button>
        </div>

        <app-household-switcher />

        <nav class="sidebar__nav">
          <a
            *ngFor="let item of visibleNavItems()"
            [routerLink]="item.path"
            routerLinkActive="sidebar__item--active"
            class="sidebar__item"
            (click)="closeSidebar()"
          >
            <app-icon class="sidebar__icon" [name]="item.icon" [size]="20" [label]="null" />
            <span class="sidebar__label">{{ item.labelKey | t }}</span>
          </a>
        </nav>

        <div class="sidebar__footer">
          <a routerLink="/settings" class="sidebar__item" (click)="closeSidebar()">
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
      <div *ngIf="isSidebarOpen()" class="sidebar-overlay" (click)="closeSidebar()"></div>

      <!-- Main Content -->
      <main class="main">
        <app-page-container [bounded]="true">
          <router-outlet></router-outlet>
        </app-page-container>
      </main>

      <!-- Mobile Bottom Navigation -->
      <nav class="bottom-nav">
        <a
          *ngFor="let item of visibleMobileNavItems()"
          [routerLink]="item.path"
          routerLinkActive="bottom-nav__item--active"
          class="bottom-nav__item"
        >
          <app-icon class="bottom-nav__icon" [name]="item.icon" [size]="22" [label]="null" />
          <span class="bottom-nav__label">{{ item.labelKey | t }}</span>
        </a>
      </nav>
    </div>

    <app-household-planning-automation-notice
      *ngIf="activeHouseholdId() as planningHouseholdId"
      [householdId]="planningHouseholdId"
      [canManage]="canManagePlanningAutomation()"
      [canActivate]="canActivatePlanningAutomation()"
    />

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

        @media (min-width: 1024px) {
          transform: translateX(0);
        }
      }

      .sidebar--open {
        transform: translateX(0);
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
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        color: var(--primary);
      }

      .sidebar__close {
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
        background: rgba(0, 0, 0, 0.5);

        @media (min-width: 1024px) {
          display: none;
        }
      }

      /* Main Content */
      .main {
        padding-top: 56px;
        padding-bottom: calc(64px + env(safe-area-inset-bottom));
        min-height: 100vh;

        @media (min-width: 1024px) {
          margin-left: 280px;
          padding-top: 0;
          padding-bottom: 0;
        }
      }

      /* Bottom Navigation */
      .bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: space-around;
        height: 64px;
        padding-bottom: env(safe-area-inset-bottom);
        background: var(--bg-secondary);
        border-top: 1px solid var(--border-default);

        @media (min-width: 1024px) {
          display: none;
        }
      }

      .bottom-nav__item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-1);
        flex: 1 1 0;
        min-width: 0;
        padding: var(--space-2) var(--space-1);
        color: var(--text-tertiary);
        text-decoration: none;
        transition: var(--transition-fast);

        &--active {
          color: var(--primary);
        }

        &:hover {
          color: var(--text-primary);
        }
      }

      .bottom-nav__icon {
        font-size: var(--text-xl);
      }

      .bottom-nav__label {
        display: block;
        width: 100%;
        font-size: 10px;
        font-weight: var(--font-medium);
        overflow: hidden;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `
  ]
})
export class MainLayoutComponent implements OnInit {
  authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly householdService = inject(HouseholdService);
  private readonly modules = inject(ModulesService);
  private sidebarTrigger: HTMLElement | null = null;
  isSidebarOpen = signal(false);

  ngOnInit(): void {
    this.householdService
      .loadMemberships()
      .subscribe(() => this.householdService.ensureHousehold());
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

  mobileNavItems: NavItem[] = [
    { path: '/dashboard', labelKey: 'nav.dashboard', icon: 'home' },
    { path: '/pantry', labelKey: 'nav.pantry', icon: 'inventory_2' },
    { path: '/recipes', labelKey: 'nav.recipes', icon: 'menu_book' },
    { path: '/calendar', labelKey: 'nav.calendar', icon: 'calendar_today' },
    { path: '/shopping', labelKey: 'nav.shopping', icon: 'shopping_cart' },
    { path: '/settings', labelKey: 'nav.settings', icon: 'settings' }
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
  readonly visibleMobileNavItems = computed(() =>
    this.mobileNavItems.filter((item) => this.modules.isPathVisible(item.path))
  );

  toggleSidebar(event: MouseEvent): void {
    const opening = !this.isSidebarOpen();
    this.sidebarTrigger =
      opening && event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.isSidebarOpen.set(opening);
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
    this.sidebarTrigger = null;
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

  navigateToProfile(): void {
    // El avatar habla de la persona, y desde la ronda 13 tiene pagina propia: /account (nombre,
    // foto, contrasena). Preferencias es del comensal —gustos, alergias, objetivo— y Configuracion
    // de la app (tema, idioma, modulos): tres preguntas distintas, tres sitios.
    this.closeSidebar();
    this.router.navigate(['/account']);
  }

  logout(): void {
    this.authService.logout();
  }
}
