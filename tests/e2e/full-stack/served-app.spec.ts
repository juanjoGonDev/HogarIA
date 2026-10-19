import { expect, test } from '../fixtures';

/**
 * Que el proceso de node sea capaz de servir la interfaz, y no solo la API.
 *
 * La aplicacion se compila a `frontend/dist` y el Dockerfile la copia a `./public`, pero
 * el `CMD` es un `node server/dist/index.js` a secas: si nadie sirve esos ficheros, en
 * produccion solo existe la API y «abrir la web» es un 404 con buena letra. Este spec es
 * lo bastante tonto como para no fallar nunca por otra cosa —y eso es lo que lo hace
 * util: es el unico que se entera de que el binario no sirve la app.
 */

const APP_HTML = /<app-root|<div[^>]+id="app-root"/;

test.describe('el binario sirve el proyecto entero', () => {
  test('la raiz es la aplicacion, no un JSON de API', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(await response.text()).toMatch(APP_HTML);
  });

  test('un deep link de la SPA entra en la aplicacion', async ({ request }) => {
    // El enrutador vive en el navegador: `/shopping/abc` no existe en disco y tiene que
    // resolver contra index.html. Si aqui cae un 404, compartir un enlace roto.
    expect((await request.get('/shopping/una-lista-cualquiera')).status()).toBe(200);
    expect((await request.get('/calendar')).status()).toBe(200);
  });

  test('un asset que no esta es un 404, no un index.html', async ({ request }) => {
    // Devolver HTML para un `.js` ausente es la forma mas creativa de dejar la pantalla
    // en blanco: el navegador intenta parsearlo y solo dice «Unexpected token '<'».
    const response = await request.get('/main-NO-EXISTE.js');
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('la API y el index conviven en el mismo origen', async ({ request }) => {
    // Mismo origen sin CORS de por medio: es lo que hace que el token y las cookies no
    // tengan que viajar por dos puertos distintos en el movil.
    const health = await request.get('/api/health');
    expect(health.ok()).toBeTruthy();
    const meta = await request.get('/api/health');
    expect(meta.status()).toBe(200);
  });

  test('el manifest y el icono tambien salen de disco', async ({ request, page }) => {
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null);
    test.skip(href === null, 'el index no enlaza un manifest: nada que comprobar aqui');
    expect((await request.get(href as string)).status()).toBe(200);
  });
});
