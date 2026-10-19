import { expect, test } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';

/**
 * El visor de logs, con el stream de verdad por en medio.
 *
 * Es la pantalla a la que se acude cuando algo va mal y la que menos se prueba: en
 * desarrollo el SSE pasa por el proxy de `ng serve`, en el contenedor por nginx y en el
 * binario a secas no habia ni servidor estatico. Y su fallo era silencioso de las dos
 * formas posibles —no llegaba nada, y el estado de la conexion no se veia—, asi que
 * alguien tardo rondas en descubrir que el servidor SI escribia.
 *
 * Aqui se exige lo contrario: que la pantalla diga en que estado esta, y que una linea
 * escrita en el servidor APAREZCA sin recargar.
 */

test.describe('visor de logs en vivo', () => {
  test('llega a «En vivo» y enseña lo que escribe el servidor', async ({ page, request }) => {
    await registerAndGoto(page, '/logs', 'full-logs');

    const status = page.locator('[data-test="logs-status"]');
    await expect(status).toContainText('En vivo', { timeout: 15_000 });
    // El login y el onboarding ya han dejado lineas: el historico tiene que salir en la
    // misma visita, no hace falta un F5 para verlo.
    await expect(page.locator('[data-test="logs-line"]').first()).toBeVisible();

    const marker = `e2e-un-vistazo-${Date.now()}`;
    // Cualquier peticion al API pasa por el logger de la app, y el logger esta enganchado
    // al almacen: una peticion = una linea nueva.
    await request.get(`/api/${marker}`);

    await expect(page.locator('body')).toContainText(marker, { timeout: 10_000 });
  });

  test('al volver a la pantalla se reconecta, sin tanda de reintentos', async ({ page }) => {
    const streams: string[] = [];
    page.on('request', (entry) => {
      if (entry.url().includes('/api/logs/stream')) streams.push(entry.url());
    });

    await registerAndGoto(page, '/logs', 'full-logs-reconnect');
    await expect(page.locator('[data-test="logs-status"]')).toContainText('En vivo', { timeout: 15_000 });

    const openedOnVisit = streams.length;
    await page.goto('/dashboard');
    await page.goto('/logs');
    await expect(page.locator('[data-test="logs-status"]')).toContainText('En vivo', { timeout: 15_000 });

    // Una conexion por visita, ni una por segundo. Es la diferencia entre «reintentar» y
    // denegar el servicio a toda la casa abriendo la pantalla de vez en cuando.
    expect(streams.length).toBeLessThanOrEqual(openedOnVisit + 1);
  });
});
