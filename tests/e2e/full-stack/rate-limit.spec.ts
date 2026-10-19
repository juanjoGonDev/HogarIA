import { expect, test } from '@playwright/test';

/**
 * El limitador, probado como lo que es: una defensa, no un castigo colectivo.
 *
 * Nunca se probo. No es que no hubiera forma: es que la suite de desarrollo lo apaga
 * (`DISABLE_RATE_LIMIT=1`) porque los 381 tests comparten IP, y al apagarlo se fue
 * tambien la unica oportunidad de ver lo que hacia —que era, con la clave de cubo
 * antigua, dejar a TODA la casa sin API en cuanto un navegador entraba en bucle. Ni la
 * pantalla de navegacion ni el visor de logs respondian: las dos cosas que hacen falta
 * para enterarse del bucle.
 *
 * Este spec usa una sesion de mentira (`Authorization: Bearer ...`) a proposito: el cubo
 * se deriva de la sesion, asi que se puede agotar sin tocar el de la aplicacion que estan
 * usando los demas tests del mismo servidor.
 */

// El limite por defecto es 600/min; con 900 peticiones se corta seguro, y la espera maxima
// es la ventana (60 s). El presupuesto del test lo cubre con margen.
test.describe.configure({ mode: 'serial' });

const SESSION = 'Bearer e2e-full-stack-rate-limit-probe';

async function hit(request: import('@playwright/test').APIRequestContext, path: string) {
  return request.get(path, { headers: { authorization: SESSION }, maxRedirects: 0 });
}

test('agotar el cupo responde 429 con Retry-After y no se lleva los diagnosticos por delante', async ({ request }) => {
  const first = await hit(request, '/api/el-cubo-se-llena');
  expect(first.status()).toBe(404);

  const headers = first.headers();
  const limit = Number(/limit=(\d+)/.exec(headers['ratelimit'] ?? '')?.[1] ?? headers['x-ratelimit-limit'] ?? 600);
  expect(Number.isFinite(limit) && limit > 0, `cabecera RateLimit: ${headers['ratelimit'] ?? 'ausente'}`).toBeTruthy();

  // Se rellena el cubo hasta el mismo 429, sin adivinar el umbral de oido.
  let blocked = first;
  for (let i = 0; i < limit + 40 && blocked.status() !== 429; i += 1) {
    blocked = await hit(request, `/api/el-cubo-se-llena-${i}`);
  }
  expect(blocked.status()).toBe(429);

  const retryAfter = Number(blocked.headers()['retry-after']);
  // Sin `Retry-After` el unico consejo util es «espera», y el usuario rellena de F5.
  expect(Number.isFinite(retryAfter) && retryAfter > 0, `Retry-After: ${blocked.headers()['retry-after']}`).toBeTruthy();

  const body = await blocked.json();
  expect(body.error).toBe('Too Many Requests');
  expect(body.message).toMatch(/espera/i);

  // Y aqui esta la parte que no era obvia: el visor de logs y el health check tienen que
  // seguir contestando. Un limitador que tambien bloquea los diagnosticos convierte un
  // aviso en un apagon, y eso es lo que dejo la app inutilizable durante un minuto.
  expect((await request.get('/api/health')).status()).toBe(200);
  expect((await request.get('/api/logs?limit=1')).status()).toBe(200);
  expect((await request.get('/api/health'))
    .ok())
    .toBeTruthy();
});

test('el cupo se recupera solo, sin reiniciar nada', async ({ request }) => {
  test.setTimeout(150_000);

  // Mismo cubo que el test anterior (misma sesion de mentira): si esto vuelve a 404, el
  // bloqueo era una ventana y no un estado permanente. Si no recuperara, la unica salida
  // seria reiniciar el contenedor —que es exactamente lo que no puede pedir una app de
  // una casa.
  await expect
    .poll(async () => (await hit(request, '/api/ya-puedo-volver')).status(), { timeout: 100_000, intervals: [1000] })
    .toBe(404);
});

test('una sesion distinta conserva su propio cupo', async ({ request }) => {
  // El detalle que evita el «no me deja probar nada»: el vecino de casa sigue comprando
  // mientras alguien, en otra pestana, agota el suyo.
  const other = 'Bearer e2e-full-stack-otra-sesion';
  for (let i = 0; i < 5; i += 1) {
    expect((await request.get('/api/la-otra-sesion', { headers: { authorization: other } })).status()).toBe(404);
  }
});
