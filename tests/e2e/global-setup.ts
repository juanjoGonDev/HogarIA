/**
 * Arranca antes de los workers. Dos cosas, y las dos para que el tiempo de CI no
 * se vaya en esperas:
 *
 * 1. Fija la semilla del run en `process.env` para que la vean el reporter, las
 *    pruebas y el backend que se levanta con ellas.
 * 2. Calienta el dev server del frontend: `ng serve` (esbuild) no compila el
 *    bundle hasta la primera peticion, y Playwright considera el servidor "listo"
 *    en cuanto el puerto responde. Sin esto, el primer test de cada worker se
 *    comia la compilacion en frio dentro de su propio timeout.
 */
import { E2E_SEED } from './helpers/seed';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4200';
const WARM_PATHS = ['/', '/main.js', '/polyfills.js', '/styles.css', '/shopping'];
const BUDGET_MS = 180_000;

async function warmUp(): Promise<string> {
  const deadline = Date.now() + BUDGET_MS;
  let warmed = '';

  while (Date.now() < deadline) {
    try {
      const responses = await Promise.all(
        WARM_PATHS.map((path) => fetch(`${BASE}${path}`).then((r) => r.status).catch(() => 0))
      );
      // El index tiene que responder; los chunks pueden llegar en otro orden.
      if (responses[0] === 200) {
        warmed = WARM_PATHS.map((path, i) => `${path}=${responses[i]}`).join(' ');
        break;
      }
    } catch {
      // Todavia no escucha el puerto: es normal, el webServer esta arrancando.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return warmed || `sin calentar (presupuesto de ${BUDGET_MS / 1000}s agotado)`;
}

export default async function globalSetup(): Promise<void> {
  const warmed = await warmUp();
  // eslint-disable-next-line no-console
  console.log(`[hogar] semilla e2e: ${E2E_SEED} · ${warmed}`);
}
