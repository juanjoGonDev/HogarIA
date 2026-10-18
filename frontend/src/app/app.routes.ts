import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { AuthLayoutComponent } from './layouts/auth-layout/auth-layout.component';
import { InviteComponent } from './features/invite/invite.component';
import { aiHouseholdSettingsGuard } from './core/guards/ai-household-settings.guard';
import { householdRequiredGuard } from './core/guards/household-required.guard';
import { translationBundlesResolver } from './core/i18n/translation-bundles.resolver';

export const routes: Routes = [
  // Auth routes (no auth required)
  {
    path: 'auth',
    component: AuthLayoutComponent,
    resolve: { translations: translationBundlesResolver('auth') },
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES)
  },

  // Public invite page (works before & after login)
  {
    path: 'invite/:code',
    component: InviteComponent,
    resolve: { translations: translationBundlesResolver('invite', 'auth', 'household') }
  },

  // Configuración inicial (a pantalla completa, justo después de registrarse).
  // Fuera del layout principal a propósito: no es una vista a la que volver a
  // diario, es el questionario de bienvenida. Luego se edita en /preferences.
  {
    path: 'onboarding',
    canActivate: [authGuard, householdRequiredGuard],
    resolve: {
      translations: translationBundlesResolver(
        'onboarding',
        'preferences',
        'taste',
        'aiConfig',
        'calendar',
        'profile',
        'homeProfilePicker'
      )
    },
    loadChildren: () =>
      import('./features/onboarding/onboarding.routes').then((m) => m.ONBOARDING_ROUTES)
  },

  // Protected routes with main layout
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    canActivateChild: [householdRequiredGuard],
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        resolve: { translations: translationBundlesResolver('dashboard', 'calendar', 'pantry') },
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES)
      },
      {
        path: 'pantry',
        resolve: {
          translations: translationBundlesResolver(
            'pantry',
            'calendar',
            'household',
            'aiConfig',
            'auth',
            'onboarding',
            'caducidades',
            'shoppingListDetail',
            'shoppingLists',
            'shoppingSuggested'
          )
        },
        loadChildren: () => import('./features/pantry/pantry.routes').then((m) => m.PANTRY_ROUTES)
      },
      {
        path: 'recipes',
        resolve: {
          translations: translationBundlesResolver(
            'recipes',
            'dashboard',
            'aiConfig',
            'household',
            'pantry',
            'calendar',
            'taste',
            'aiParticipants'
          )
        },
        loadChildren: () =>
          import('./features/recipes/recipes.routes').then((m) => m.RECIPES_ROUTES)
      },
      {
        path: 'shopping',
        resolve: {
          translations: translationBundlesResolver(
            'shoppingLists',
            'shoppingListDetail',
            'shoppingSuggested',
            'account',
            'auth',
            'calendar',
            'pantry',
            'household'
          )
        },
        loadChildren: () =>
          import('./features/shopping/shopping.routes').then((m) => m.SHOPPING_ROUTES)
      },
      {
        path: 'receipts',
        loadChildren: () =>
          import('./features/receipts/receipts.routes').then((m) => m.RECEIPTS_ROUTES)
      },
      {
        path: 'calendar',
        resolve: {
          translations: translationBundlesResolver(
            'calendar',
            'aiParticipants',
            'household',
            'recipes',
            'pantry',
            'taste',
            'preferences',
            'dashboard'
          )
        },
        loadChildren: () =>
          import('./features/calendar/calendar.routes').then((m) => m.CALENDAR_ROUTES)
      },
      {
        path: 'household',
        resolve: {
          translations: translationBundlesResolver(
            'household',
            'aiConfig',
            'calendar',
            'dashboard',
            'onboarding',
            'recipes',
            'preferences',
            'settings',
            'shoppingSuggested',
            'pantry',
            'taste',
            'aiParticipants'
          )
        },
        loadChildren: () =>
          import('./features/household/household.routes').then((m) => m.HOUSEHOLD_ROUTES)
      },
      {
        path: 'ai-config',
        canActivate: [aiHouseholdSettingsGuard],
        resolve: { translations: translationBundlesResolver('aiConfig', 'auth', 'dashboard') },
        loadChildren: () =>
          import('./features/ai-config/ai-config.routes').then((m) => m.AI_CONFIG_ROUTES)
      },
      {
        path: 'logs',
        resolve: { translations: translationBundlesResolver('logs', 'calendar', 'household') },
        loadChildren: () => import('./features/logs/logs.routes').then((m) => m.LOGS_ROUTES)
      },
      {
        path: 'account',
        resolve: {
          translations: translationBundlesResolver('account', 'auth', 'avatarEditor', 'calendar')
        },
        loadChildren: () =>
          import('./features/account/account.routes').then((m) => m.ACCOUNT_ROUTES)
      },
      {
        path: 'preferences',
        resolve: {
          translations: translationBundlesResolver(
            'preferences',
            'profile',
            'taste',
            'onboarding',
            'calendar',
            'homeProfilePicker',
            'aiParticipants'
          )
        },
        loadChildren: () =>
          import('./features/preferences/preferences.routes').then((m) => m.PREFERENCES_ROUTES)
      },
      {
        path: 'settings',
        resolve: { translations: translationBundlesResolver('settings') },
        loadChildren: () =>
          import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES)
      }
    ]
  },

  // Wildcard
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
