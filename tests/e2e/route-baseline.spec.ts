import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Request } from '@playwright/test';
import { expect, test } from './fixtures';
import { createHousehold, registerToOnboarding, skipOnboarding } from './helpers/auth';
import {
  AUTHENTICATED_ROUTES,
  ONBOARDING_ROUTE,
  PUBLIC_ROUTES,
  type RouteCase
} from './helpers/route-layout-manifest';

type ViewportCase = { width: number; height: number };

const VIEWPORTS: ViewportCase[] = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];

type RouteMeasurement = {
  path: string;
  viewport: ViewportCase;
  actualUrl: string;
  componentVisible: boolean;
  viewportWidth: number;
  documentWidth: number;
  horizontalOverflow: number;
};

const EXPECTED_FIXTURE_404S = new Map<string, string>([
  ['/api/household/invite/qa-baseline-invalid-code', 'GET'],
  ['/api/pantry/products/qa-baseline-missing-item', 'GET'],
  ['/api/recipes/qa-baseline-missing-recipe', 'GET'],
  ['/api/receipts/qa-baseline-missing-receipt', 'GET'],
  ['/api/shopping/lists/qa-baseline-missing-list', 'GET'],
  ['/api/shopping/stream/lists/qa-baseline-missing-list', 'GET']
]);

function safeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.startsWith('/@fs/') ? '/@fs/[vite-module]' : url.pathname;
    return `${url.origin}${pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function safePath(path: string): string {
  try {
    return new URL(path, 'http://localhost').pathname;
  } catch {
    return '[invalid-path]';
  }
}

function safeDiagnostic(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeUrl(url))
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bwebapi_[A-Za-z0-9_-]+/gi, '[redacted-provider-token]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(
      /(["']?[\w.-]*(?:token|secret|password|api[_-]?key|authorization|cookie|credential)[\w.-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,&#}]+)/gi,
      '$1[redacted]'
    );
}

type HttpClassification = 'fixture-not-found' | 'cache-revalidation' | 'unexpected';

function classifyHttpResponse(status: number, path: string, method: string): HttpClassification {
  const isStaticAsset =
    !path.startsWith('/api/') &&
    (['/@vite/', '/@fs/', '/@id/'].some((prefix) => path.startsWith(prefix)) ||
      /\.(?:avif|css|gif|ico|jpe?g|js|otf|png|svg|ttf|webp|woff2?)$/i.test(path));

  if (status === 304 && ['GET', 'HEAD'].includes(method) && isStaticAsset)
    return 'cache-revalidation';
  if (status === 404 && EXPECTED_FIXTURE_404S.get(path) === method) return 'fixture-not-found';
  return 'unexpected';
}

test('baseline público y autenticado: rutas, errores de navegador y overflow', async ({
  page
}, testInfo) => {
  test.setTimeout(300_000);

  const sanitized = safeDiagnostic(
    'https://user:pass@example.test/path?access_token=private#fragment ' +
      'Bearer private-secret webapi_private-token user@example.test token=inline-secret ' +
      'refresh_token=refresh-private client_secret=client-private apiKey=key-private'
  );
  expect(safeUrl('https://user:pass@example.test/path?token=private#fragment')).toBe(
    'https://example.test/path'
  );
  expect(safeUrl('https://example.test/@fs/D:/private/path.mjs?token=private')).toBe(
    'https://example.test/@fs/[vite-module]'
  );
  expect(sanitized).not.toMatch(/private|example\.test.*\?|fragment|user@example\.test/);
  expect(classifyHttpResponse(404, '/api/pantry/products/qa-baseline-missing-item', 'GET')).toBe(
    'fixture-not-found'
  );
  expect(classifyHttpResponse(404, '/api/pantry/products/qa-baseline-missing-item', 'POST')).toBe(
    'unexpected'
  );
  expect(classifyHttpResponse(304, '/chunk.js', 'GET')).toBe('cache-revalidation');
  expect(classifyHttpResponse(304, '/@vite/client', 'GET')).toBe('cache-revalidation');
  expect(classifyHttpResponse(304, '/@fs/vite/env.mjs', 'GET')).toBe('cache-revalidation');
  expect(classifyHttpResponse(304, '/chunk.js', 'HEAD')).toBe('cache-revalidation');
  expect(classifyHttpResponse(304, '/chunk.js', 'POST')).toBe('unexpected');
  expect(classifyHttpResponse(304, '/api/recipes', 'GET')).toBe('unexpected');

  const baseUrl = process.env.E2E_BASE_URL;
  expect(baseUrl, 'el baseline solo corre con el origen del runner aislado').toBeTruthy();
  const appOrigin = new URL(baseUrl!).origin;
  const activeRoute = { path: 'setup' };
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const resourceLoadErrors = new Map<string, number>();
  const externalConsoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const canceledRequests: string[] = [];
  const externalRequestFailures = new Map<string, number>();
  const requestRoutes = new WeakMap<Request, string>();
  const httpResponses = new Map<
    string,
    {
      route: string;
      method: string;
      path: string;
      status: number;
      classification: HttpClassification;
    }
  >();
  const measurements: RouteMeasurement[] = [];
  const missingComponents: string[] = [];
  const navigationErrors: string[] = [];

  page.on('request', (request) => {
    const referer = request.headers()['referer'];
    let route = safePath(activeRoute.path);
    if (referer) {
      try {
        const source = new URL(referer);
        if (source.origin === appOrigin) route = source.pathname;
      } catch {
        // The request's declared navigation path remains the fallback.
      }
    }
    requestRoutes.set(request, route);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(`${error.name}: ${safeDiagnostic(error.message)}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    const text = safeDiagnostic(message.text());
    if (text.includes('Failed to load resource:')) {
      const key = location ? safeUrl(location) : '[unknown-resource]';
      resourceLoadErrors.set(key, (resourceLoadErrors.get(key) ?? 0) + 1);
      return;
    }
    const line = text;
    if (!location || new URL(location).origin === appOrigin) consoleErrors.push(line);
    else externalConsoleErrors.push(`${line} (${safeUrl(location)})`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    const route = requestRoutes.get(request) ?? 'unknown';
    const line = `${route}: ${request.method()} ${safeUrl(request.url())} (${safeDiagnostic(failure)})`;
    if (new URL(request.url()).origin === appOrigin) {
      if (failure.includes('ERR_ABORTED')) canceledRequests.push(line);
      else requestFailures.push(line);
    } else {
      const key = `${safeUrl(request.url())} (${safeDiagnostic(failure)})`;
      externalRequestFailures.set(key, (externalRequestFailures.get(key) ?? 0) + 1);
    }
  });
  page.on('response', (response) => {
    if (
      (response.status() >= 200 && response.status() < 300) ||
      new URL(response.url()).origin !== appOrigin
    )
      return;
    const path = new URL(response.url()).pathname;
    const reportPath = path.startsWith('/@fs/') ? '/@fs/[vite-module]' : path;
    const method = response.request().method();
    const route = requestRoutes.get(response.request()) ?? 'unknown';
    const classification = classifyHttpResponse(response.status(), path, method);
    const key = `${route}|${method}|${reportPath}|${response.status()}`;
    httpResponses.set(key, {
      route,
      method,
      path: reportPath,
      status: response.status(),
      classification
    });
  });

  async function visit(route: RouteCase, viewport: ViewportCase): Promise<void> {
    activeRoute.path = route.path;
    await page.setViewportSize(viewport);

    try {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      navigationErrors.push(
        `${route.path.split('?')[0]} @ ${viewport.width}x${viewport.height}: ${safeDiagnostic(String(error))}`
      );
      return;
    }

    const visible = await page
      .locator(route.component)
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!visible)
      missingComponents.push(
        `${safePath(route.path)}: ${route.component} @ ${viewport.width}x${viewport.height}; actual=${safePath(page.url())}`
      );

    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => {
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - viewportWidth)
      };
    });
    measurements.push({
      path: safePath(route.path),
      viewport,
      actualUrl: new URL(page.url()).pathname,
      componentVisible: visible,
      ...layout
    });

    if (
      process.env.E2E_SCREENSHOT_DIR &&
      route.path === '/dashboard' &&
      ((testInfo.project.name === 'chromium' && viewport.width === 1440) ||
        (testInfo.project.name === 'mobile-chrome' && viewport.width === 320))
    ) {
      mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: join(
          process.env.E2E_SCREENSHOT_DIR,
          `dashboard-${testInfo.project.name}-${viewport.width}x${viewport.height}.png`
        )
      });
    }
  }

  // Public pages and the unauthenticated guard are checked before registering the synthetic user.
  for (const viewport of VIEWPORTS) {
    for (const route of PUBLIC_ROUTES) await visit(route, viewport);
  }
  activeRoute.path = '/settings (sin sesión)';
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/auth\/login(?:\?|$)/);

  await registerToOnboarding(page, 'QA baseline');
  await createHousehold(page, 'Hogar sintético baseline');
  await page.goto(ONBOARDING_ROUTE.path);
  for (const viewport of VIEWPORTS) await visit(ONBOARDING_ROUTE, viewport);
  await skipOnboarding(page);

  for (const viewport of VIEWPORTS) {
    for (const route of AUTHENTICATED_ROUTES) await visit(route, viewport);
  }

  const overflow = measurements.filter((measurement) => measurement.horizontalOverflow > 1);
  const report = {
    isolated: Boolean(process.env.E2E_RUN_DIR && process.env.DATABASE_PATH && process.env.E2E_SEED),
    project: testInfo.project.name,
    viewports: VIEWPORTS,
    routeCount: PUBLIC_ROUTES.length + 1 + AUTHENTICATED_ROUTES.length,
    measurements: measurements.length,
    pageErrors,
    consoleErrors,
    requestFailures,
    canceledRequests: canceledRequests.length,
    externalConsoleErrors,
    resourceLoadErrors: [...resourceLoadErrors].map(([resource, count]) => ({ resource, count })),
    externalRequestFailures: [...externalRequestFailures].map(([failure, count]) => ({
      failure,
      count
    })),
    non2xxResponses: [...httpResponses.values()],
    navigationErrors,
    missingComponents,
    overflow: overflow.map(
      ({ path, viewport, viewportWidth, documentWidth, horizontalOverflow }) => ({
        path,
        viewport,
        viewportWidth,
        documentWidth,
        horizontalOverflow
      })
    )
  };
  console.log(`[qa-baseline] ${JSON.stringify(report)}`);
  testInfo.annotations.push({ type: 'route-baseline', description: JSON.stringify(report) });

  expect(navigationErrors, 'todas las rutas deben responder desde la SPA aislada').toEqual([]);
  expect(missingComponents, 'cada URL debe cargar su componente de ruta actual').toEqual([]);
  expect(pageErrors, 'no debe haber excepciones JavaScript sin capturar').toEqual([]);
  expect(consoleErrors, 'no debe haber errores de consola del origen de la app').toEqual([]);
  expect(requestFailures, 'no debe haber requests fallidas al origen de la app').toEqual([]);
  expect(
    [...httpResponses.values()].filter((response) => response.classification === 'unexpected'),
    'no debe haber respuestas HTTP no-2xx inesperadas en el origen de la app'
  ).toEqual([]);
  expect(
    overflow,
    'las superficies baseline no deben desbordar el viewport horizontalmente'
  ).toEqual([]);
});
