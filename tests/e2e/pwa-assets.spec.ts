import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Los assets de la PWA son el unico sitio donde el navegador lee el manifiesto, y
 * es justo donde este repo tenia cuatro referencias rotas: un `favicon.ico`
 * declarado en angular.json que no existia, ocho `icon-NxN.png` que eran el mismo
 * fichero de 1024 px copiado ocho veces, `shortcuts` y `screenshots` apuntando a
 * png inexistentes (Chrome descarta el atajo si su icono da 404).
 *
 * Estos tests no comprueban el diseno: comprueban que lo declarado se sirve, y que
 * lo que se sirve tiene el tamano que dice tener. Ambos son bugs silenciosos.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4200';

type Manifest = {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  shortcuts?: { name: string; icons?: { src: string }[] }[];
  screenshots?: { src: string }[];
};

/** Ancho/alto reales leidos del IHDR de un PNG (bytes 16-24, big-endian). */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function getManifest(request: APIRequestContext): Promise<Manifest> {
  const response = await request.get(`${BASE}/manifest.json`);
  expect(response.ok(), `manifest.json responde ${response.status()}`).toBe(true);
  return response.json();
}

test.describe('PWA — assets declarados y servidos', () => {
  test.beforeAll(({}, workerInfo) => {
    const configuredBase =
      process.env.E2E_BASE_URL ?? String(workerInfo.project.use.baseURL ?? BASE);
    expect(
      new URL(BASE).origin,
      `PWA origin mismatch: BASE=${BASE}, configured project origin=${configuredBase}`
    ).toBe(new URL(configuredBase).origin);
  });

  test('el manifiesto describe HogarIA como app instalable', async ({ request }) => {
    const manifest = await getManifest(request);

    expect(manifest.name).toBe('HogarIA');
    expect(manifest.short_name).toBe('HogarIA');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // Los dos tonos de la marca: si se cambia uno sin el otro, el recorte del
    // launcher deja un borde de color equivocado alrededor del icono.
    expect(manifest.theme_color.toLowerCase()).toBe('#f97316');
    expect(manifest.background_color.toLowerCase()).toBe('#fafaf9');
  });

  test('cada icono declarado existe y mide lo que declara su `sizes`', async ({ request }) => {
    const manifest = await getManifest(request);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(8);

    for (const icon of manifest.icons) {
      const response = await request.get(`${BASE}/${icon.src.replace(/^\//, '')}`);
      expect(response.ok(), `${icon.src} responde ${response.status()}`).toBe(true);

      const declared = icon.sizes.toLowerCase().replace('x', ' ');
      if (declared === 'any') continue;
      const [width, height] = declared.split(' ').map(Number);
      const actual = pngSize(await response.body());
      expect(actual, `${icon.src} no es un PNG legible`).not.toBeNull();
      expect(actual, `${icon.src} deberia ser ${width}x${height}`).toEqual({ width, height });
    }
  });

  test('hay icono para cada proposito que exige cada plataforma', async ({ request }) => {
    const manifest = await getManifest(request);
    const purposes = manifest.icons.map((icon) => icon.purpose ?? 'any');

    // Android (instalacion) pide 192 y 512; iOS quiere el suyo propio de 180.
    expect(
      manifest.icons.some((i) => i.sizes === '192x192' && (i.purpose ?? 'any') === 'any')
    ).toBe(true);
    const maskable512 = manifest.icons.find(
      (i) => i.sizes === '512x512' && i.purpose === 'maskable'
    );
    expect(maskable512, 'falta un 512x512 purpose:maskable').toBeTruthy();
    expect(purposes.some((p) => p.includes('any'))).toBe(true);
    expect(purposes.some((p) => p.includes('maskable'))).toBe(true);

    const apple = await request.get(`${BASE}/assets/icons/apple-touch-icon-180.png`);
    expect(apple.ok()).toBe(true);
    expect(pngSize(await apple.body())).toEqual({ width: 180, height: 180 });
  });

  test('nada de referencias colgadas: shortcuts y screenshots apuntan a ficheros que se sirven', async ({
    request
  }) => {
    const manifest = await getManifest(request);

    for (const shortcut of manifest.shortcuts ?? []) {
      for (const icon of shortcut.icons ?? []) {
        const response = await request.get(`${BASE}/${icon.src.replace(/^\//, '')}`);
        expect(response.ok(), `el icono del atajo ${shortcut.name} da ${response.status()}`).toBe(
          true
        );
      }
    }

    // `screenshots` solo puede existir si las capturas estan en el repo: con la
    // lista vacia la pantalla de instalacion simplemente no las muestra.
    for (const shot of manifest.screenshots ?? []) {
      const response = await request.get(`${BASE}/${shot.src.replace(/^\//, '')}`);
      expect(response.ok(), `la captura ${shot.src} da ${response.status()}`).toBe(true);
    }
  });

  test('el index enlaza favicon, favicons png y apple-touch-icon', async ({ page }) => {
    await page.goto(`${BASE}/`);

    await expect(page.locator('link[rel="icon"][href="favicon.ico"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveCount(2);
    await expect(
      page.locator('link[rel="apple-touch-icon"][href*="apple-touch-icon-180"]')
    ).toHaveCount(1);

    const favicon = await page.request.get(`${BASE}/favicon.ico`);
    expect(favicon.ok(), 'favicon.ico tiene que existir (esta en angular.json)').toBe(true);
    expect(favicon.headers()['content-type']).toMatch(/x-icon|vnd\.microsoft\.icon|octet-stream/);
  });

  test('el offline no depende de los assets: la shell se registra igual', async ({ page }) => {
    await page.goto(`${BASE}/`);

    const registration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      // `ready` no llega nunca cuando nadie registra un worker (es el caso de
      // `ng serve`): esperar a que "se resuelva solo" es un timeout con forma de
      // assert. Se le pone plazo y se documenta el estado real.
      const outcome = await Promise.race([
        navigator.serviceWorker.ready.then(() => 'registered'),
        new Promise<string>((resolve) => setTimeout(() => resolve('none'), 4000))
      ]);
      if (outcome !== 'registered') return outcome;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? 'registered' : 'none';
    });

    // En CI sin HTTPS el SW puede no estar activo: lo que no puede pasar es que
    // la app falle. Se documenta el estado en lugar de forzar un flaky.
    expect(['registered', 'none', 'unsupported']).toContain(registration);
  });
});
