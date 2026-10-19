export type RouteAccess = 'public' | 'onboarding' | 'authenticated';
export type RouteShell = 'auth' | 'invite' | 'onboarding' | 'private';
export type RootDisplay = 'block' | 'flex' | 'grid';

/** Baseline for every distinct page/content root represented in this manifest. */
export const ROOT_DISPLAY_EXPECTATIONS: Readonly<Record<string, RootDisplay>> = {
  'app-account > .account-page': 'flex',
  'app-ai-config > .ai-config': 'block',
  'app-ai-provider-queue-page > .ai-queue-page': 'block',
  'app-auth-layout > .auth-layout': 'flex',
  'app-auth-layout > .auth-layout > app-page-container > .auth-layout__container': 'flex',
  'app-caducidades > .cad': 'grid',
  'app-calendar > .calendar': 'grid',
  'app-dashboard > .dashboard': 'block',
  'app-household > .household': 'block',
  'app-invite > .invite-page': 'flex',
  'app-logs > .logs-page': 'flex',
  'app-onboarding > app-page-container > .onboarding': 'flex',
  'app-pantry > .pantry': 'block',
  'app-pantry-catalog > .gestor': 'flex',
  'app-pantry-categories > .gestor': 'flex',
  'app-pantry-item > .item': 'flex',
  'app-pantry-item-edit > .editar': 'flex',
  'app-pantry-products > .gestor': 'flex',
  'app-preferences > .preferences-page': 'flex',
  'app-receipt-detail > .ficha': 'grid',
  'app-receipts > .tickets': 'grid',
  'app-recipes > .recipes': 'block',
  'app-settings > .settings-page': 'flex',
  'app-shopping-list-detail > .detail': 'flex',
  'app-shopping-lists > .tray': 'flex'
};

export type RouteCase = {
  path: string;
  component: string;
  access: RouteAccess;
  shell: RouteShell;
  pageRoot?: string;
  contentRoot?: string;
  readySelector?: string;
  readyContent?: { selector: string; text: string };
  finalPath?: string;
};

/** Rutas con IDs creados por la prueba: evitan que un caso dinámico pase solo por su estado 404. */
export function populatedDynamicRoutes(ids: {
  categoryId: string;
  productId: string;
  aiConfigId: string;
  inventoryItemId: string;
  shoppingListId: string;
  receiptId: string;
  recipeId: string;
}): RouteCase[] {
  return [
    {
      path: `/recipes?recipe=${encodeURIComponent(ids.recipeId)}`,
      component: 'app-recipes',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-recipes > .recipes',
      readySelector: '.recipe-detail',
      readyContent: {
        selector: '.recipe-detail__description',
        text: 'Fixture sintético para comprobar navegación y deep links.'
      }
    },
    {
      path: `/pantry/categories/${encodeURIComponent(ids.categoryId)}`,
      component: 'app-pantry-categories',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-pantry-categories > .gestor',
      readySelector: '[data-test="gestor-categorias-ficha"]'
    },
    {
      path: `/pantry/products/${encodeURIComponent(ids.productId)}`,
      component: 'app-pantry-products',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-pantry-products > .gestor',
      readySelector: '[data-test="gestor-productos-ficha"]'
    },
    {
      path: `/ai-config/${encodeURIComponent(ids.aiConfigId)}/queue`,
      component: 'app-ai-provider-queue-page',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-ai-provider-queue-page > .ai-queue-page',
      readySelector: '[data-test="ai-provider-queue"]'
    },
    {
      path: `/pantry/inventario/${encodeURIComponent(ids.inventoryItemId)}`,
      component: 'app-pantry-item',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-pantry-item > .item',
      readySelector: '.item__nombre',
      readyContent: { selector: '.item__nombre', text: 'QA Layout Inventory Item' }
    },
    {
      path: `/pantry/inventario/${encodeURIComponent(ids.inventoryItemId)}/editar`,
      component: 'app-pantry-item-edit',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-pantry-item-edit > .editar',
      readySelector: '[data-test="editar-stock"]',
      readyContent: { selector: '.editar__nombre', text: 'QA Layout Inventory Item' }
    },
    {
      path: `/shopping/${encodeURIComponent(ids.shoppingListId)}`,
      component: 'app-shopping-list-detail',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-shopping-list-detail > .detail',
      readySelector: '[data-test="item-row"]',
      readyContent: { selector: '.detail__title', text: 'QA Layout Shopping List' }
    },
    {
      path: `/receipts/${encodeURIComponent(ids.receiptId)}`,
      component: 'app-receipt-detail',
      access: 'authenticated',
      shell: 'private',
      pageRoot: 'app-receipt-detail > .ficha',
      readySelector: '[data-test="ticket-error"]',
      readyContent: { selector: 'h1.ficha__titulo', text: 'QA Layout Receipt Store' }
    }
  ];
}

export const PUBLIC_ROUTES: RouteCase[] = [
  {
    path: '/auth/login',
    component: 'app-login',
    access: 'public',
    shell: 'auth',
    pageRoot: 'app-auth-layout > .auth-layout',
    contentRoot: 'app-auth-layout > .auth-layout > app-page-container > .auth-layout__container'
  },
  {
    path: '/auth/register',
    component: 'app-register',
    access: 'public',
    shell: 'auth',
    pageRoot: 'app-auth-layout > .auth-layout',
    contentRoot: 'app-auth-layout > .auth-layout > app-page-container > .auth-layout__container'
  },
  {
    path: '/auth/forgot-password',
    component: 'app-forgot-password',
    access: 'public',
    shell: 'auth',
    pageRoot: 'app-auth-layout > .auth-layout',
    contentRoot: 'app-auth-layout > .auth-layout > app-page-container > .auth-layout__container'
  },
  {
    path: '/auth',
    finalPath: '/auth/login',
    component: 'app-login',
    access: 'public',
    shell: 'auth',
    pageRoot: 'app-auth-layout > .auth-layout',
    contentRoot: 'app-auth-layout > .auth-layout > app-page-container > .auth-layout__container'
  },
  {
    path: '/invite/qa-baseline-invalid-code',
    component: 'app-invite',
    access: 'public',
    shell: 'invite',
    pageRoot: 'app-invite > .invite-page'
  }
];

export const ONBOARDING_ROUTE: RouteCase = {
  path: '/onboarding',
  component: 'app-onboarding',
  access: 'onboarding',
  shell: 'onboarding',
  pageRoot: 'app-onboarding > app-page-container > .onboarding',
  contentRoot: 'app-onboarding > app-page-container > .onboarding'
};

// Paths and component hosts revalidated against app.routes.ts and features/*/*.routes.ts.
// The static baseline keeps nonexistent IDs for error states; populatedDynamicRoutes() adds real detail cases.
export const AUTHENTICATED_ROUTES: RouteCase[] = [
  {
    path: '/',
    finalPath: '/dashboard',
    component: 'app-dashboard',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-dashboard > .dashboard'
  },
  {
    path: '/qa-layout-unknown-route',
    finalPath: '/dashboard',
    component: 'app-dashboard',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-dashboard > .dashboard'
  },
  {
    path: '/dashboard',
    component: 'app-dashboard',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-dashboard > .dashboard'
  },
  {
    path: '/pantry',
    component: 'app-pantry',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry > .pantry'
  },
  {
    path: '/pantry/caducidades',
    component: 'app-caducidades',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-caducidades > .cad'
  },
  {
    path: '/pantry/inventario/qa-baseline-missing-item',
    component: 'app-pantry-item',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-item > .item'
  },
  {
    path: '/pantry/inventario/qa-baseline-missing-item/editar',
    component: 'app-pantry-item-edit',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-item-edit > .editar'
  },
  {
    path: '/pantry/categories',
    component: 'app-pantry-categories',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-categories > .gestor'
  },
  {
    path: '/pantry/categories/new',
    component: 'app-pantry-categories',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-categories > .gestor'
  },
  {
    path: '/pantry/catalogo',
    component: 'app-pantry-catalog',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-catalog > .gestor'
  },
  {
    path: '/pantry/products',
    component: 'app-pantry-products',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-products > .gestor'
  },
  {
    path: '/pantry/products/new',
    component: 'app-pantry-products',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-pantry-products > .gestor'
  },
  {
    path: '/recipes',
    component: 'app-recipes',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-recipes > .recipes'
  },
  {
    path: '/recipes?recipe=qa-baseline-missing-recipe',
    finalPath: '/recipes',
    component: 'app-recipes',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-recipes > .recipes'
  },
  {
    path: '/shopping',
    component: 'app-shopping-lists',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-shopping-lists > .tray'
  },
  {
    path: '/shopping/qa-baseline-missing-list',
    component: 'app-shopping-list-detail',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-shopping-list-detail > .detail'
  },
  {
    path: '/receipts',
    component: 'app-receipts',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-receipts > .tickets'
  },
  {
    path: '/receipts/qa-baseline-missing-receipt',
    component: 'app-receipt-detail',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-receipt-detail > .ficha'
  },
  {
    path: '/calendar',
    component: 'app-calendar',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-calendar > .calendar'
  },
  {
    path: '/household',
    component: 'app-household',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-household > .household'
  },
  {
    path: '/ai-config',
    component: 'app-ai-config',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-ai-config > .ai-config'
  },
  {
    path: '/logs',
    component: 'app-logs',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-logs > .logs-page'
  },
  {
    path: '/account',
    component: 'app-account',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-account > .account-page'
  },
  {
    path: '/preferences',
    component: 'app-preferences',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-preferences > .preferences-page'
  },
  {
    path: '/settings',
    component: 'app-settings',
    access: 'authenticated',
    shell: 'private',
    pageRoot: 'app-settings > .settings-page'
  }
];
