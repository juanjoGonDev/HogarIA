import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

import { validateIsolatedEnvironment } from './server/tests/support/e2e-isolation.mjs';

const isolation = validateIsolatedEnvironment(process.env);
const reportDir = process.env.E2E_REPORT_DIR ?? join(isolation.runDir, 'playwright-report');
const outputDir = process.env.E2E_OUTPUT_DIR ?? join(isolation.runDir, 'artifacts');

export default defineConfig({
  testDir: './tests/e2e',
  // Los specs de `full-stack/` piden el stack de produccion (build servido por el binario, limits ON):
  // el dev shard no se los puede cargar sin pintar rojos estructurales —los cinco del run de la ## 12af
  // eran eso, no codigo roto—, y los corre su propio job con su config (`playwright.full-stack.config.ts`).
  testIgnore: ['**/full-stack/**', '**/ai-real-smoke.spec.ts'],
  // Fija la semilla del run antes que nada: la ven workers, reporter y backend.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // En CI queda margen para el chunk perezoso de la ruta nueva que toca a cada
  // worker (el arranque frio del bundle ya se paga en globalSetup), pero no 120s:
  // un timeout largo multiplica por el numero de tests cualquier cascada, y eso es
  // literalmente como se ha colgado este job. 90s cubre el peor caso conocido.
  timeout: process.env.CI ? 90000 : 60000,
  retries: process.env.CI ? 1 : 0,
  // Local stays at one worker to cap browser/Angular memory; CI uses two per shard.
  workers: process.env.CI ? 2 : 1,
  reporter: [
    // `list`, y no el reporter propio que se citaba aqui: `tools/reporters/hogaria-e2e-reporter.js`
    // nunca llego al repositorio, y un path inexistente no degrada —Playwright falla antes de correr el
    // primer test, que es exactamente como se quedo esta suite sin ejecutar en CI. Si se quiere de
    // vuelta el arbol con semilla y los mas lentos, se escribe y se trae en su propia tanda; mientras no
    // este, el arbol por `it` con duracion de `list` dice lo esencial.
    ['list'],
    // El informe HTML sigue siendo el sitio donde ver el trace de un fallo.
    ['html', { open: 'never', outputFolder: reportDir }],
    [
      'json',
      { outputFile: process.env.E2E_RESULTS_FILE ?? join(isolation.runDir, 'results.json') }
    ],
    // XML para quien lo quiera consumir (CI, IDEs, quality gates).
    ['junit', { outputFile: join(isolation.runDir, 'junit.xml') }]
  ],
  outputDir,
  use: {
    baseURL: isolation.baseUrl,
    // El idioma del navegador, fijado: con `language: 'auto'` la app mira `navigator.language`, y en CI eso
    // es `en-US`. Toda la suite esta escrita contra el espanol de la interfaz, asi que sin este ancla un
    // test verde en mi maquina es rojo en la suya —y al reves— sin que nadie haya tocado la app.
    locale: 'es-ES',
    // En sandboxes de Windows el cierre del contexto puede fallar al exportar trace/video
    // (spawn EPERM). Los tests visuales guardan capturas explícitas; CI conserva artefactos.
    trace: process.env.CI ? 'on-first-retry' : 'off',
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    // Acotados, pero con margen: recortar esto a 15/20s convirtio 5 fallos
    // reales en 69 (la compilacion en frio del dev server de CI no da abasto).
    actionTimeout: 45000,
    navigationTimeout: 60000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_CHROME_BIN
          ? { launchOptions: { executablePath: process.env.E2E_CHROME_BIN } }
          : {})
      }
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        ...(process.env.E2E_CHROME_BIN
          ? { launchOptions: { executablePath: process.env.E2E_CHROME_BIN } }
          : {})
      }
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] }
    }
  ]
});
