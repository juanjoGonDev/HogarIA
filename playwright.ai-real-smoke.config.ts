import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

import { validateIsolatedEnvironment } from './server/tests/support/e2e-isolation.mjs';

const isolation = validateIsolatedEnvironment(process.env);
const positiveTimeoutFromEnvironment = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid isolated AI smoke timeout: ${name}`);
  }
  return value;
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['ai-real-smoke.spec.ts'],
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: true,
  timeout: positiveTimeoutFromEnvironment('HOGARIA_AI_REAL_SMOKE_TEST_TIMEOUT_MS', 20 * 60_000),
  globalTimeout: positiveTimeoutFromEnvironment(
    'HOGARIA_AI_REAL_SMOKE_GLOBAL_TIMEOUT_MS',
    21 * 60_000
  ),
  retries: 0,
  workers: 1,
  reporter: [['dot']],
  outputDir: join(isolation.runDir, 'ai-real-smoke-output'),
  use: {
    baseURL: isolation.baseUrl,
    locale: 'es-ES',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  },
  projects: [
    {
      name: 'chromium-ai-real-smoke',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_CHROME_BIN
          ? { launchOptions: { executablePath: process.env.E2E_CHROME_BIN } }
          : {})
      }
    }
  ]
});
