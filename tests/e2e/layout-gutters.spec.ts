import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TestInfo } from '@playwright/test';

import { expect, test, type Page } from './fixtures';
import { registerAndGoto, registerWithHousehold } from './helpers/auth';
import { createSyntheticRecipe, deleteSyntheticRecipe } from './helpers/recipe-fixtures';
import {
  attachVisualFamilyInventory,
  collectVisualFamilyMeasurements,
  safeRoute,
  type VisualFamilyMeasurement
} from './helpers/visual-family-inventory';
import {
  AUTHENTICATED_ROUTES,
  ONBOARDING_ROUTE,
  populatedDynamicRoutes,
  PUBLIC_ROUTES,
  ROOT_DISPLAY_EXPECTATIONS,
  type RouteCase,
  type RouteShell
} from './helpers/route-layout-manifest';

type ViewportCase = { width: number; height: number };
type RouteViewportAudit = {
  route: string;
  shell: RouteShell;
  viewport: string;
  documentWidth: number;
  documentClientWidth: number;
  horizontalOverflow: boolean;
  pageErrors: string[];
};

async function addVisualInventorySample(
  page: Page,
  target: RouteCase,
  viewport: ViewportCase,
  measurements: VisualFamilyMeasurement[],
  sampledRoutes: string[]
): Promise<void> {
  if (viewport.width !== 393 && viewport.width !== 1440) return;
  sampledRoutes.push(target.path);
  measurements.push(...(await collectVisualFamilyMeasurements(page, target, viewport)));
}

const WIDTH_BREAKPOINTS = [
  339, 359, 360, 362, 389, 400, 420, 480, 481, 560, 600, 601, 639, 640, 641, 719, 720, 721, 760,
  767, 768, 799, 800, 801, 860, 900, 920, 959, 1023, 1024, 1100, 1199, 1200, 1279, 1280
];

const VIEWPORTS: ViewportCase[] = (() => {
  const widths = new Set([320, 360, 390, 393, 430, 568, 768, 1023, 1024, 1280, 1440, 1920]);
  for (const breakpoint of WIDTH_BREAKPOINTS) {
    widths.add(breakpoint - 1);
    widths.add(breakpoint);
    widths.add(breakpoint + 1);
  }

  const viewports = new Map<string, ViewportCase>();
  for (const width of widths) {
    const viewport = {
      width,
      // Keep 568×320 as a real landscape viewport; other widths exercise normal page flow.
      height:
        width === 568
          ? 320
          : width === 390
            ? 844
            : width >= 1920
              ? 1080
              : width < 768
                ? 851
                : width < 1024
                  ? 768
                  : 900
    };
    viewports.set(`${viewport.width}x${viewport.height}`, viewport);
  }

  // Acceptance viewports used by the spec that are not implied by the width/B±1 set.
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 320, height: 740 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 932, height: 430 },
    { width: 1024, height: 768 }
  ]) {
    viewports.set(`${viewport.width}x${viewport.height}`, viewport);
  }

  return [...viewports.values()].sort(
    (left, right) => left.width - right.width || left.height - right.height
  );
})();

function collectFrontendSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFrontendSourceFiles(path);
    if (
      !entry.isFile() ||
      !/\.(?:css|scss|ts)$/i.test(entry.name) ||
      /\.spec\.ts$/i.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function frontendWidthBreakpoints(): number[] {
  const files = collectFrontendSourceFiles(resolve(process.cwd(), 'frontend/src'));
  const breakpoints = new Set<number>();
  const mediaHeaders = /@media\b([^{}]*)\{/gi;
  const widthFeatures = /\((?:min|max)-width\s*:\s*([^)]+)\)/gi;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const [, header] of source.matchAll(mediaHeaders)) {
      for (const [, rawValue] of header.matchAll(widthFeatures)) {
        const value = rawValue.trim().match(/^(\d+(?:\.\d+)?)(px|rem|em)$/i);
        if (!value)
          throw new Error(`No se puede normalizar el breakpoint CSS ${rawValue} (${file})`);
        const pixels = Number(value[1]) * (value[2].toLowerCase() === 'px' ? 1 : 16);
        if (!Number.isInteger(pixels)) {
          throw new Error(`El breakpoint CSS no cae en un píxel entero: ${rawValue} (${file})`);
        }
        breakpoints.add(pixels);
      }
    }
  }

  return [...breakpoints].sort((left, right) => left - right);
}

test('la matriz responsive prueba B−1/B/B+1 de cada breakpoint del frontend', () => {
  const widths = new Set(VIEWPORTS.map(({ width }) => width));
  const missing = frontendWidthBreakpoints().flatMap((breakpoint) =>
    [-1, 0, 1]
      .map((offset) => breakpoint + offset)
      .filter((width) => !widths.has(width))
      .map((width) => `${width}px (breakpoint ${breakpoint}px)`)
  );

  expect(missing, 'todos los media queries de ancho requieren B−1/B/B+1').toEqual([]);
});

test('el contrato de display cubre exactamente todas las raíces estáticas y dinámicas', () => {
  const routes = [
    ...PUBLIC_ROUTES,
    ONBOARDING_ROUTE,
    ...AUTHENTICATED_ROUTES,
    ...populatedDynamicRoutes({
      categoryId: 'layout-category',
      productId: 'layout-product',
      aiConfigId: 'layout-ai-config',
      inventoryItemId: 'layout-item',
      shoppingListId: 'layout-shopping-list',
      receiptId: 'layout-receipt',
      recipeId: 'layout-recipe'
    })
  ];
  const roots = new Set(
    routes.flatMap((route) => [route.pageRoot, route.contentRoot].filter(Boolean))
  );

  expect(Object.keys(ROOT_DISPLAY_EXPECTATIONS).sort()).toEqual([...roots].sort());
});

const SHELL_HOSTS: Record<RouteShell, string> = {
  auth: 'app-auth-layout',
  invite: 'app-invite',
  onboarding: 'app-onboarding',
  private: 'app-main-layout'
};

const ALL_SHELL_HOSTS = Object.values(SHELL_HOSTS);
const PRIVATE_ROUTE_BATCH_SIZE = Math.ceil(AUTHENTICATED_ROUTES.length / 2);
const AUTHENTICATED_ROUTE_BATCHES = [
  AUTHENTICATED_ROUTES.slice(0, PRIVATE_ROUTE_BATCH_SIZE),
  AUTHENTICATED_ROUTES.slice(PRIVATE_ROUTE_BATCH_SIZE)
];

function expectedGutter(width: number): number {
  if (width >= 1024) return 32;
  if (width >= 768) return 24;
  return 16;
}

async function attachAndSaveRouteViewportAudit(
  testInfo: TestInfo,
  fileName: string,
  routes: readonly RouteViewportAudit[]
): Promise<void> {
  const report = {
    acceptanceViewports: VIEWPORTS,
    routes,
    horizontalOverflowCount: routes.filter((row) => row.horizontalOverflow).length,
    pageErrorCount: routes.reduce((count, row) => count + row.pageErrors.length, 0)
  };
  const serialized = JSON.stringify(report, null, 2);
  await testInfo.attach(fileName, {
    body: Buffer.from(serialized),
    contentType: 'application/json'
  });

  const outputDirectory = process.env.E2E_LAYOUT_AUDIT_DIR;
  if (!outputDirectory) return;

  const directory = join(resolve(outputDirectory), testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), serialized, { encoding: 'utf8', flag: 'wx' });
  console.log(
    `[qa-layout-route-matrix] ${JSON.stringify({
      report: join(directory, fileName),
      routeViewportRows: routes.length,
      horizontalOverflowCount: report.horizontalOverflowCount,
      pageErrorCount: report.pageErrorCount
    })}`
  );
}

async function checkPageContainer(
  page: Page,
  target: RouteCase,
  viewport: ViewportCase,
  navigateToRoute: boolean
): Promise<string[]> {
  await page.setViewportSize(viewport);
  if (navigateToRoute) await page.goto(target.path, { waitUntil: 'domcontentloaded' });

  const expectedShell = SHELL_HOSTS[target.shell];
  await expect(
    page.locator(expectedShell),
    `${target.path} debe conservar ${expectedShell}`
  ).toHaveCount(1);
  await expect(page.locator(expectedShell)).toBeVisible();
  for (const shell of ALL_SHELL_HOSTS) {
    if (shell !== expectedShell) {
      await expect(
        page.locator(shell),
        `${target.path} no debe montar un shell duplicado`
      ).toHaveCount(0);
    }
  }

  await expect(
    page.locator(target.component),
    `${target.path} debe montar ${target.component}`
  ).toBeVisible();
  if (target.readySelector) {
    await expect(
      page.locator(target.readySelector),
      `${target.path} debe mostrar su vista poblada, no un estado vacío o 404`
    ).toBeVisible();
  }
  if (target.readyContent) {
    await expect(
      page.locator(target.readyContent.selector),
      `${target.path} debe mostrar el registro sintético esperado`
    ).toHaveText(target.readyContent.text);
  }
  const actualUrl = new URL(page.url());
  const expectedUrl = new URL(target.finalPath ?? target.path, page.url());
  const actualPath = `${actualUrl.pathname}${actualUrl.search}${actualUrl.hash}`;
  const expectedPath = `${expectedUrl.pathname}${expectedUrl.search}${expectedUrl.hash}`;
  const mismatches: string[] = [];
  if (actualPath !== expectedPath) {
    await expect
      .poll(() => {
        const current = new URL(page.url());
        return `${current.pathname}${current.search}${current.hash}`;
      }, `${target.path} debe finalizar en ${expectedPath}`)
      .toBe(expectedPath);
  }

  if (target.pageRoot) {
    const roots = page.locator(target.pageRoot);
    await expect(roots, `${target.path} debe tener una superficie raíz`).toHaveCount(1);
    const rootLayout = await roots.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        paddingStart: Number.parseFloat(style.paddingInlineStart),
        paddingEnd: Number.parseFloat(style.paddingInlineEnd)
      };
    });
    const expectedPageRootDisplay = ROOT_DISPLAY_EXPECTATIONS[target.pageRoot];
    if (rootLayout.display !== expectedPageRootDisplay) {
      mismatches.push(
        `${target.path} @ ${viewport.width}x${viewport.height}: display de raíz esperado ${expectedPageRootDisplay}, actual ${rootLayout.display}`
      );
    }
    if (rootLayout.paddingStart !== 0 || rootLayout.paddingEnd !== 0) {
      mismatches.push(
        `${target.path} @ ${viewport.width}x${viewport.height}: el wrapper de feature duplica el gutter con padding ${rootLayout.paddingStart}/${rootLayout.paddingEnd}`
      );
    }
  }

  const frames = page.locator('app-page-container');
  const frameCount = await frames.count();
  if (frameCount !== 1) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: esperado 1 app-page-container, actual ${frameCount}`
    );
    return mismatches;
  }

  const geometry = await frames.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const parent = element.parentElement?.getBoundingClientRect();

    return {
      bounded: element.classList.contains('page-container--bounded'),
      maxWidth: style.maxWidth,
      gutterStart: Number.parseFloat(style.paddingInlineStart),
      gutterEnd: Number.parseFloat(style.paddingInlineEnd),
      frameStart: rect.left,
      frameEnd: rect.right,
      parentStart: parent?.left ?? 0,
      parentEnd: parent?.right ?? window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      overflowCandidates: Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .map((candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          return {
            tag: candidate.tagName.toLowerCase(),
            className: candidate.getAttribute('class')?.replace(/\s+/g, ' ').slice(0, 80) ?? '',
            right: Math.round(candidateRect.right),
            width: Math.round(candidateRect.width)
          };
        })
        .filter(
          (candidate) =>
            candidate.width > 0 && candidate.right > document.documentElement.clientWidth + 1
        )
        .sort((left, right) => right.right - left.right)
        .slice(0, 5),
      contentStart: rect.left + Number.parseFloat(style.paddingInlineStart),
      contentEnd: rect.right - Number.parseFloat(style.paddingInlineEnd)
    };
  });

  const expected = expectedGutter(viewport.width);
  const tolerance = 1;
  if (!geometry.bounded) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: todos los shells deben usar el marco común limitado al ancho de lectura`
    );
  }
  const expectedMaxWidth = '1280px';
  if (geometry.maxWidth !== expectedMaxWidth) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: max-width esperado ${expectedMaxWidth}, actual ${geometry.maxWidth}`
    );
  }
  if (geometry.gutterStart !== expected || geometry.gutterEnd !== expected) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: gutters esperados ${expected}/${expected}px, actuales ${geometry.gutterStart}/${geometry.gutterEnd}px`
    );
  }
  if (
    geometry.frameStart < geometry.parentStart - tolerance ||
    geometry.frameEnd > geometry.parentEnd + tolerance ||
    geometry.contentStart < geometry.frameStart + expected - tolerance ||
    geometry.contentEnd > geometry.frameEnd - expected + tolerance
  ) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: borde exterior del contenedor fuera de su shell o gutter no aplicado a la caja real`
    );
  }
  const contentRoot =
    target.contentRoot ??
    (target.shell === 'private' || target.shell === 'onboarding' ? target.pageRoot : undefined);
  if (contentRoot) {
    const rootLocator = page.locator(contentRoot);
    await expect(rootLocator, `${target.path} debe exponer su raíz de contenido`).toHaveCount(1);
    const root = await rootLocator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        start: rect.left,
        end: rect.right,
        width: rect.width,
        display: style.display,
        maxWidth: style.maxWidth,
        paddingStart: Number.parseFloat(style.paddingInlineStart),
        paddingEnd: Number.parseFloat(style.paddingInlineEnd),
        paddingBlockStart: Number.parseFloat(style.paddingBlockStart),
        paddingBlockEnd: Number.parseFloat(style.paddingBlockEnd)
      };
    });
    const expectedContentRootDisplay = ROOT_DISPLAY_EXPECTATIONS[contentRoot];
    if (root.display !== expectedContentRootDisplay) {
      mismatches.push(
        `${target.path} @ ${viewport.width}x${viewport.height}: display de contenido esperado ${expectedContentRootDisplay}, actual ${root.display}`
      );
    }
    if (
      Math.abs(root.start - geometry.contentStart) > tolerance ||
      Math.abs(root.end - geometry.contentEnd) > tolerance ||
      root.maxWidth !== 'none' ||
      root.paddingStart !== 0 ||
      root.paddingEnd !== 0
    ) {
      mismatches.push(
        `${target.path} @ ${viewport.width}x${viewport.height}: raíz ${root.width}px (max-width ${root.maxWidth}, padding ${root.paddingStart}/${root.paddingEnd}) no ocupa el contenido común del main (${geometry.contentStart}–${geometry.contentEnd}px)`
      );
    }
    if (
      target.shell === 'private' &&
      (Math.abs(root.paddingBlockStart - geometry.gutterStart) > tolerance ||
        Math.abs(root.paddingBlockEnd - geometry.gutterEnd) > tolerance)
    ) {
      mismatches.push(
        `${target.path} @ ${viewport.width}x${viewport.height}: padding vertical de raíz ${root.paddingBlockStart}/${root.paddingBlockEnd}px; gutter inline del main ${geometry.gutterStart}/${geometry.gutterEnd}px`
      );
    }
  }
  if (geometry.documentWidth > geometry.documentClientWidth + tolerance) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: overflow horizontal del documento (${geometry.documentWidth}px > ${geometry.documentClientWidth}px); elementos: ${JSON.stringify(geometry.overflowCandidates)}`
    );
  }

  return mismatches;
}

async function checkRouteAcrossViewports(
  page: Page,
  target: RouteCase,
  mismatches: string[],
  auditRows: RouteViewportAudit[],
  afterViewport?: (viewport: ViewportCase) => Promise<void>
): Promise<void> {
  for (const [index, viewport] of VIEWPORTS.entries()) {
    const pageErrors: string[] = [];
    const onPageError = (error: Error) => {
      const message = error.message.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
        try {
          const url = new URL(candidate);
          return `${url.origin}${url.pathname}`;
        } catch {
          return '[URL redacted]';
        }
      });
      pageErrors.push(`${error.name || 'Error'}: ${message.slice(0, 320)}`);
    };
    page.on('pageerror', onPageError);
    try {
      mismatches.push(...(await checkPageContainer(page, target, viewport, index === 0)));
      await afterViewport?.(viewport);
      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth
      }));
      const horizontalOverflow = dimensions.documentWidth > dimensions.documentClientWidth + 1;
      if (pageErrors.length > 0) {
        mismatches.push(
          `${target.path} @ ${viewport.width}x${viewport.height}: pageerror (${pageErrors.join(', ')})`
        );
      }
      auditRows.push({
        route: safeRoute(target.path),
        shell: target.shell,
        viewport: `${viewport.width}x${viewport.height}`,
        ...dimensions,
        horizontalOverflow,
        pageErrors: [...pageErrors]
      });
    } finally {
      page.off('pageerror', onPageError);
    }
  }
}

/** Crea exclusivamente filas/configuración sintéticas bajo el usuario que acaba de registrar el test. */
async function createPopulatedDynamicRouteFixtures(page: Page): Promise<{
  categoryId: string;
  productId: string;
  aiConfigId: string;
  inventoryItemId: string;
  shoppingListId: string;
  receiptId: string;
  recipeId: string;
  recipe: Awaited<ReturnType<typeof createSyntheticRecipe>>;
}> {
  const result = await page.evaluate(async () => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    if (!token) throw new Error('No hay token de la cuenta E2E sintética');
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    };
    const send = async (path: string, body: unknown) => {
      const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`No se pudo crear fixture sintética (${path}, ${response.status})`);
      }
      return payload.data;
    };

    // Subir el ticket ANTES de crear la config .invalid de cobertura de la cola. La cuenta
    // recién registrada no tiene proveedor: el worker lo mueve a NO_CONFIG sin invocar red externa.
    const receiptForm = new FormData();
    receiptForm.append(
      'file',
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'qa-layout-receipt.png',
        { type: 'image/png' }
      )
    );
    const receiptUpload = await fetch('/api/receipts', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: receiptForm
    });
    const receiptPayload = await receiptUpload.json();
    if (!receiptUpload.ok) {
      throw new Error(
        `No se pudo crear fixture sintética (/api/receipts, ${receiptUpload.status})`
      );
    }
    const receiptId = String(receiptPayload.data.id);
    const deadline = Date.now() + 15_000;
    let receipt = receiptPayload.data;
    while (receipt.status === 'queued' || receipt.status === 'analyzing') {
      if (Date.now() >= deadline) {
        throw new Error('La fixture sintética de ticket no llegó al estado terminal esperado');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const response = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          `No se pudo leer fixture sintética (/api/receipts/:id, ${response.status})`
        );
      }
      receipt = payload.data;
    }
    if (receipt.status !== 'failed' || receipt.error !== 'NO_CONFIG') {
      throw new Error('La fixture de ticket debe fallar de forma determinista con NO_CONFIG');
    }
    const receiptMetadata = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ store: 'QA Layout Receipt Store', purchaseDate: '2026-10-02' })
    });
    if (!receiptMetadata.ok) {
      throw new Error(
        `No se pudieron fijar metadatos de fixture (/api/receipts/:id, ${receiptMetadata.status})`
      );
    }

    const inventoryItem = await send('/api/pantry/ingredients', {
      name: 'QA Layout Inventory Item',
      category: 'dairy',
      quantity: 2,
      unit: 'unit',
      location: 'pantry'
    });
    const shoppingList = await send('/api/shopping/lists', {
      name: 'QA Layout Shopping List',
      store: 'QA Store'
    });
    await send(`/api/shopping/lists/${encodeURIComponent(String(shoppingList.id))}/items`, {
      name: 'QA Layout Shopping Item',
      quantity: 1,
      unit: 'unit'
    });

    const category = await send('/api/pantry/categories', {
      name: 'QA Layout Category',
      description: 'Fixture sintética de rutas'
    });
    const product = await send('/api/pantry/products', {
      name: 'QA Layout Product',
      category: category.key,
      quantity: 0
    });
    const config = await send('/api/ai/configs', {
      name: 'QA Layout Synthetic Provider',
      provider: 'custom',
      // Dominio reservado .invalid: este test navega la cola vacía y nunca invoca al proveedor.
      baseUrl: 'https://layout-route-coverage.invalid/v1',
      apiKey: 'synthetic-route-coverage-only',
      model: 'synthetic-layout-model',
      concurrency: 1,
      retryAttempts: 0,
      timeout: 1000
    });
    return {
      categoryId: String(category.id),
      productId: String(product.id),
      aiConfigId: String(config.id),
      inventoryItemId: String(inventoryItem.id),
      shoppingListId: String(shoppingList.id),
      receiptId
    };
  });
  const recipe = await createSyntheticRecipe(page, { name: 'QA Layout Recipe' });
  expect(result.categoryId).toBeTruthy();
  expect(result.productId).toBeTruthy();
  expect(result.aiConfigId).toBeTruthy();
  return { ...result, recipeId: recipe.id, recipe };
}

async function assertDashboardCaptureReady(page: Page, viewport: ViewportCase): Promise<void> {
  await expect(page.locator('app-dashboard > .dashboard')).toBeVisible();
  await expect(page.locator('app-page-container')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator('.sidebar-overlay')).toBeHidden();

  const sidebar = page.locator('.sidebar');
  const menuButton = page.locator('.header__menu');
  if (viewport.width < 1024) {
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toHaveClass(/sidebar--open/);
    await expect
      .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right))
      .toBeLessThanOrEqual(1);
  } else {
    await expect(menuButton).toBeHidden();
    await expect(sidebar).toBeVisible();
  }
}

function privateRouteScreenshotName(
  target: RouteCase,
  state: 'route' | 'populated',
  viewport: 'desktop' | 'mobile'
): string {
  const route = target.path
    .replace(/[A-Za-z0-9_-]{15,}/g, 'fixture')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${target.component.replace(/^app-/, '')}-${route}-${state}-${viewport}.png`;
}

async function assertPrivateContentCanReachEnd(
  page: Page,
  target: RouteCase,
  viewport: ViewportCase,
  mismatches: string[]
): Promise<void> {
  if (!target.pageRoot) return;

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrollState = await page.evaluate((selector) => {
    const root = document.querySelector<HTMLElement>(selector);
    const navigation = document.querySelector<HTMLElement>('.bottom-nav');
    const navigationRect = navigation?.getBoundingClientRect();
    const scrollable = document.scrollingElement;
    return {
      scrollTop: scrollable?.scrollTop ?? 0,
      maxScroll: Math.max(0, (scrollable?.scrollHeight ?? 0) - window.innerHeight),
      rootBottom: root?.getBoundingClientRect().bottom ?? 0,
      obstructionTop:
        navigationRect && navigationRect.height > 0 ? navigationRect.top : window.innerHeight
    };
  }, target.pageRoot);

  if (scrollState.maxScroll > 1 && scrollState.scrollTop < scrollState.maxScroll - 1) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: el documento no llega al final con scroll (${scrollState.scrollTop}/${scrollState.maxScroll}px)`
    );
  }
  if (scrollState.rootBottom > scrollState.obstructionTop + 1) {
    mismatches.push(
      `${target.path} @ ${viewport.width}x${viewport.height}: el final de la raíz queda bajo la navegación fija (${scrollState.rootBottom}/${scrollState.obstructionTop}px)`
    );
  }

  await page.evaluate(() => window.scrollTo(0, 0));
}

async function auditRouteGroup(
  page: Page,
  testInfo: TestInfo,
  targets: readonly RouteCase[],
  groupName: string,
  afterViewport?: (target: RouteCase, viewport: ViewportCase, mismatches: string[]) => Promise<void>
): Promise<void> {
  const mismatches: string[] = [];
  const routeViewportAudit: RouteViewportAudit[] = [];
  const visualMeasurements: VisualFamilyMeasurement[] = [];
  const sampledRoutes: string[] = [];
  for (const target of targets) {
    await checkRouteAcrossViewports(
      page,
      target,
      mismatches,
      routeViewportAudit,
      async (viewport) => {
        await afterViewport?.(target, viewport, mismatches);
        await addVisualInventorySample(page, target, viewport, visualMeasurements, sampledRoutes);
      }
    );
  }

  const retrySuffix = testInfo.retry > 0 ? `-retry-${testInfo.retry}` : '';

  await attachVisualFamilyInventory(
    testInfo,
    `visual-family-inventory-${groupName}${retrySuffix}.json`,
    visualMeasurements,
    sampledRoutes
  );
  await attachAndSaveRouteViewportAudit(
    testInfo,
    `layout-route-viewport-audit-${groupName}${retrySuffix}.json`,
    routeViewportAudit
  );

  expect(
    mismatches,
    `${groupName}: las rutas deben conservar el shell, alinear la raíz con el marco común y compartir el gutter del main también en el eje vertical privado`
  ).toEqual([]);
}

test('las rutas públicas y onboarding conservan su shell y el gutter común', async ({
  page
}, testInfo) => {
  test.setTimeout(240_000);

  await auditRouteGroup(page, testInfo, PUBLIC_ROUTES, 'public');
  await registerAndGoto(page, '/onboarding', 'Layout gutter QA');
  await auditRouteGroup(page, testInfo, [ONBOARDING_ROUTE], 'onboarding');
});

test('los lotes de rutas privadas cubren el manifiesto exactamente una vez', () => {
  expect(AUTHENTICATED_ROUTE_BATCHES.flat()).toEqual(AUTHENTICATED_ROUTES);
});

for (const [index, targets] of AUTHENTICATED_ROUTE_BATCHES.entries()) {
  const groupName = `private-${String(index + 1).padStart(2, '0')}`;

  test(`rutas privadas ${index + 1}/${AUTHENTICATED_ROUTE_BATCHES.length} conservan shell y gutter`, async ({
    page
  }, testInfo) => {
    test.setTimeout(240_000);

    await registerWithHousehold(page, '/dashboard', `Layout gutter QA ${index + 1}`);
    await auditRouteGroup(
      page,
      testInfo,
      targets,
      groupName,
      async (target, viewport, mismatches) => {
        if (viewport.width === 393 || viewport.width === 1440) {
          await assertPrivateContentCanReachEnd(page, target, viewport, mismatches);
        }

        const captureDesktop = testInfo.project.name === 'chromium' && viewport.width === 1440;
        const captureMobile = testInfo.project.name === 'mobile-chrome' && viewport.width === 393;
        if (captureDesktop || captureMobile) {
          const directory = process.env.E2E_SCREENSHOT_DIR;
          const screenshotName = privateRouteScreenshotName(
            target,
            'route',
            captureDesktop ? 'desktop' : 'mobile'
          );
          const retrySafeName =
            testInfo.retry > 0
              ? screenshotName.replace(/\.png$/, `-retry-${testInfo.retry}.png`)
              : screenshotName;
          const screenshotPath = directory
            ? join(directory, retrySafeName)
            : testInfo.outputPath(retrySafeName);
          mkdirSync(dirname(screenshotPath), { recursive: true });
          await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
        }

        if (
          target.path === '/dashboard' &&
          ((testInfo.project.name === 'chromium' && viewport.width === 1440) ||
            (testInfo.project.name === 'mobile-chrome' && viewport.width === 393))
        ) {
          await assertDashboardCaptureReady(page, viewport);
          const directory = process.env.E2E_SCREENSHOT_DIR;
          const screenshotName =
            testInfo.project.name === 'chromium' ? 'dashboard-desktop.png' : 'dashboard-mobile.png';
          const retrySafeName =
            testInfo.retry > 0
              ? screenshotName.replace(/\.png$/, `-retry-${testInfo.retry}.png`)
              : screenshotName;
          const screenshotPath = directory
            ? join(directory, retrySafeName)
            : testInfo.outputPath(retrySafeName);
          mkdirSync(dirname(screenshotPath), { recursive: true });
          await page.screenshot({
            path: screenshotPath,
            fullPage: false,
            animations: 'disabled'
          });
        }
      }
    );
  });
}

test('los detalles dinámicos poblados conservan shell, raíz, gutter y ancho', async ({
  page
}, testInfo) => {
  test.setTimeout(300_000);

  const mismatches: string[] = [];
  const routeViewportAudit: RouteViewportAudit[] = [];
  const visualMeasurements: VisualFamilyMeasurement[] = [];
  const sampledRoutes: string[] = [];
  await registerWithHousehold(page, '/dashboard', 'Layout gutter dynamic QA');

  const fixtures = await createPopulatedDynamicRouteFixtures(page);
  try {
    const populatedRoutes = populatedDynamicRoutes(fixtures);
    for (const target of populatedRoutes) {
      await checkRouteAcrossViewports(
        page,
        target,
        mismatches,
        routeViewportAudit,
        async (viewport) => {
          if (viewport.width === 393 || viewport.width === 1440) {
            await assertPrivateContentCanReachEnd(page, target, viewport, mismatches);
          }

          await addVisualInventorySample(page, target, viewport, visualMeasurements, sampledRoutes);

          const captureDesktop = testInfo.project.name === 'chromium' && viewport.width === 1440;
          const captureMobile = testInfo.project.name === 'mobile-chrome' && viewport.width === 393;
          if (!captureDesktop && !captureMobile) return;

          const directory = process.env.E2E_SCREENSHOT_DIR;
          const screenshotPath = directory
            ? join(
                directory,
                privateRouteScreenshotName(
                  target,
                  'populated',
                  captureDesktop ? 'desktop' : 'mobile'
                )
              )
            : testInfo.outputPath(
                privateRouteScreenshotName(
                  target,
                  'populated',
                  captureDesktop ? 'desktop' : 'mobile'
                )
              );
          mkdirSync(dirname(screenshotPath), { recursive: true });
          await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
        }
      );
    }
  } finally {
    await deleteSyntheticRecipe(page, fixtures.recipe);
  }

  await attachVisualFamilyInventory(
    testInfo,
    'visual-family-inventory-populated-details.json',
    visualMeasurements,
    sampledRoutes
  );
  await attachAndSaveRouteViewportAudit(
    testInfo,
    'layout-route-viewport-audit-populated.json',
    routeViewportAudit
  );

  expect(
    mismatches,
    'los detalles dinámicos poblados deben conservar shell, una raíz alineada con el contenido común y no tener overflow horizontal'
  ).toEqual([]);
});
