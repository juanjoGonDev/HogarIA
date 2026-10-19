import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

type ApiResult = { status: number; body: { data?: Record<string, unknown>; success?: boolean } };

async function postConfig(
  page: Parameters<typeof registerAndGoto>[0],
  payload: Record<string, unknown>
): Promise<ApiResult> {
  return page.evaluate(async (body) => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    const response = await fetch('/api/ai/configs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }, payload);
}

async function patchConcurrency(
  page: Parameters<typeof registerAndGoto>[0],
  id: string,
  concurrency: number
): Promise<ApiResult> {
  return page.evaluate(async ({ id, concurrency }) => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    const response = await fetch(`/api/ai/configs/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ concurrency })
    });
    return { status: response.status, body: await response.json() };
  }, { id, concurrency });
}

test.describe('concurrencia máxima de IA', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/ai-config', 'ai-provider-concurrency');
    await expect(page.locator('h1.ai-config__title')).toBeVisible();
  });

  test('la API rechaza negativos/fracciones y no modifica el valor guardado', async ({ page }) => {
    const config = {
      name: 'Synthetic provider',
      provider: 'custom',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'synthetic-not-a-secret',
      model: 'test-model'
    };

    for (const concurrency of [-1, 1.5, 9]) {
      const rejected = await postConfig(page, { ...config, concurrency });
      expect(rejected.status, `POST concurrency=${concurrency}`).toBe(400);
    }

    const created = await postConfig(page, config);
    expect(created.status).toBe(201);
    const id = String(created.body.data?.['id']);

    for (const concurrency of [-1, 1.5, 9]) {
      const patched = await patchConcurrency(page, id, concurrency);

      expect(patched.status, `PATCH concurrency=${concurrency}`).toBe(400);
    }
    const readBack = await page.evaluate(async () => {
      const token = localStorage.getItem('hogar:v1:auth_token');
      const response = await fetch('/api/ai/configs', {
        headers: { authorization: `Bearer ${token}` }
      });
      return response.json();
    });
    expect(readBack.data[0].concurrency).toBe(0);

    for (const concurrency of [1, 8, 0]) {
      const updated = await patchConcurrency(page, id, concurrency);
      expect(updated.status, `PATCH valid concurrency=${concurrency}`).toBe(200);
      expect(updated.body.data?.['concurrency']).toBe(concurrency);
    }
  });

  test('acepta cero como ilimitado y lo usa por defecto al crear configuración', async ({ page }) => {
    const base = {
      provider: 'custom',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'synthetic-not-a-secret',
      model: 'test-model'
    };

    const explicitZero = await postConfig(page, {
      ...base,
      name: 'Explicit unlimited',
      concurrency: 0
    });
    expect(explicitZero.status).toBe(201);
    expect(explicitZero.body.data?.['concurrency']).toBe(0);

    const defaultZero = await postConfig(page, { ...base, name: 'Default unlimited' });
    expect(defaultZero.status).toBe(201);
    expect(defaultZero.body.data?.['concurrency']).toBe(0);

    for (const concurrency of [1, 8]) {
      const bounded = await postConfig(page, {
        ...base,
        name: `Concurrency ${concurrency}`,
        concurrency
      });
      expect(bounded.status, `POST concurrency=${concurrency}`).toBe(201);
      expect(bounded.body.data?.['concurrency']).toBe(concurrency);
    }
  });

  test('el formulario muestra límites, bloquea valores negativos y conserva el modal', async ({
    page
  }) => {
    await page.getByRole('button', { name: /Agregar configuración/ }).first().click();
    await page.fill('input#name', 'Synthetic provider');
    await page.fill('input#model', 'test-model');
    await page.fill('input#baseUrl', 'http://127.0.0.1:9/v1');
    await page.fill('input#apiKey', 'synthetic-not-a-secret');

    const concurrency = page.locator('input#concurrency');
    await expect(concurrency).toHaveValue('0');
    await expect(concurrency).toHaveAttribute('min', '0');
    await expect(concurrency).toHaveAttribute('max', '8');
    await expect(concurrency).toHaveAttribute('step', '1');
    await expect(page.locator('#concurrency-helper')).toContainText('0 = ilimitado');

    let configPosts = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/ai/configs') && request.method() === 'POST') configPosts++;
    });

    await concurrency.fill('-1');
    await page.locator('app-modal button[type="submit"]').click();
    await expect(page.locator('#concurrency-error')).toBeVisible();
    await expect(concurrency).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.modal-overlay')).toBeVisible();
    expect(configPosts).toBe(0);
  });
});
