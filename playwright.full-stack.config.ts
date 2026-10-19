import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

import { validateIsolatedEnvironment } from './server/tests/support/e2e-isolation.mjs';

/**
 * Playwright contra el proyecto ENTERO levantado como en produccion: un unico proceso
 * node que sirve la API y el `index.html` compilado, con el limitador de peticiones
 * ENCENDIDO y con el visor de logs por SSE.
 *
 * Por que hace falta otra config si ya existe `playwright.config.ts`: porque el job que
 * esta funcionando usa `npm run dev` (ng serve con proxy + `tsx` en el backend) y apaga
 * el limitador —`DISABLE_RATE_LIMIT=1`— para que los 381 tests no se pisen el cupo. Es
 * la decision correcta para esa suite, y deja fuera justo lo que se rompio dos veces: la
 * interfaz compilada, servida por el mismo proceso que la API, con el limite real
 * aplicado y con el streaming de logs intacto. Un «todo verde» que no ejercita esa
 * combinacion no dice nada de ella.
 *
 * Local: `pnpm run test:e2e:full-stack` (build + isolated process supervisor).
 */

// Nada de `import.meta` ni `__dirname`: Playwright carga este fichero como CJS (el package.json de la raiz
// no declara `type: module`) y ahi `import.meta` es un SyntaxError que tumba el job ANTES de escribir un
// solo resultado —el fallo que persigue este fix—. `testDir` y `globalSetup` se resuelven solos contra la
// carpeta de esta config; el runner externo arranca y detiene el binario aislado.
const isolation = validateIsolatedEnvironment(process.env);
const base = isolation.baseUrl;
// The isolated runner starts the production binary before Playwright and points global setup at this origin.
const reportDir = process.env.E2E_REPORT_DIR ?? join(isolation.runDir, 'playwright-report');
const resultsFile = process.env.E2E_RESULTS_FILE ?? join(isolation.runDir, 'results.json');
const outputDir = process.env.E2E_OUTPUT_DIR ?? join(isolation.runDir, 'artifacts');

export default defineConfig({
  testDir: './tests/e2e/full-stack',
  // La misma semilla del run: el reporter y el backend tienen que ver lo mismo.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: process.env.CI ? 120_000 : 60_000,
  reporter: [
    ['list'],
    // Informe aparte: mezclarlo con el de la suite de desarrollo haria imposible saber
    // de que job es un fallo que se abre en el navegador.
    ['html', { open: 'never', outputFolder: reportDir }],
    // CUARTA CAUSA del job mudo, y la buena: `scripts/ci-e2e-summary.mjs` anota los fallos leyendo este
    // json, y el config del rescate se quedo sin el reporter —el job corria la suite ENTERA (4 min),
    // fallaba lo que debia fallar, y el parte decia «no se encontro results.json» como si no hubiera
    // pasado nada. Mismo fichero y misma ruta que la suite de desarrollo.
    ['json', { outputFile: resultsFile }]
  ],
  outputDir,
  use: {
    baseURL: base,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 45_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Solo para entornos sin el navegador de Playwright (sandboxes sin acceso a su CDN):
        // `E2E_CHROME_BIN=/ruta/al/chrome`. En CI la variable no existe y manda el navegador instalado.
        ...(process.env.E2E_CHROME_BIN
          ? { launchOptions: { executablePath: process.env.E2E_CHROME_BIN } }
          : {})
      }
    },
    {
      // Movil de verdad: el 429 se manifesto en el telefono, y el SSE del visor de logs
      // se corta de otra forma cuando el viewport (y el teclado en pantalla) mandan.
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        ...(process.env.E2E_CHROME_BIN
          ? { launchOptions: { executablePath: process.env.E2E_CHROME_BIN } }
          : {})
      }
    }
  ]
});
