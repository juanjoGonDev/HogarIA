import { expect, test, type Page } from '../fixtures';
import { registerWithHousehold } from '../helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key: string) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'el usuario sintético debe tener sesión autenticada').toBeTruthy();
  return token as string;
}

async function productsMatching(page: Page, token: string, query: string) {
  const response = await page.request.get(
    `/api/pantry/products?q=${encodeURIComponent(query)}&limit=10&offset=0`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(response.status(), 'la comprobación se limita al catálogo del hogar sintético').toBe(200);
  return (await response.json()) as {
    data: { id: string; name: string; aliases: string[] }[];
    meta: { total: number };
  };
}

test('el alta nueva conserva borrador y evita duplicar un producto cuando choca un alias', async ({
  page
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));

  await registerWithHousehold(page, '/pantry/products', 'QA Pantry Alias Conflict');
  const token = await tokenOf(page);
  const existingName = `QA producto conocido ${Date.now()}`;
  const draftName = `QA producto borrador ${Date.now()}`;

  await page.locator('[data-test="gestor-productos-nueva"]').click();
  await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
  await page.locator('[data-test="gestor-productos-campo-nombre"] input').fill(existingName);
  const firstPost = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/pantry/products';
  });
  await page.locator('[data-test="gestor-productos-guardar"]').click();
  const firstResponse = await firstPost;
  expect(firstResponse.status(), 'la ficha propia de referencia debe crearse').toBe(201);
  const firstProduct = (await firstResponse.json()).data as { id: string };
  await expect(page).toHaveURL(/\/pantry\/products(?:\?|$)/);

  await page.locator('[data-test="gestor-productos-nueva"]').click();
  await expect(page).toHaveURL(/\/pantry\/products\/new$/);
  await page.locator('[data-test="gestor-productos-campo-nombre"] input').fill(draftName);
  await page.locator('#gestor-producto-alias').fill(existingName);
  await page.locator('[data-test="gestor-productos-anadir-alias"]').click();
  await expect(page.locator('.alias app-tag')).toContainText(existingName);

  const conflictPost = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/pantry/products';
  });
  await page.locator('[data-test="gestor-productos-guardar"]').click();
  expect((await conflictPost).status(), 'el servidor debe rechazar el alias con HTTP 409').toBe(
    409
  );

  await expect(page).toHaveURL(/\/pantry\/products\/new$/);
  const inlineError = page.locator('[data-test="gestor-productos-error"]');
  await expect(inlineError).toHaveAttribute('role', 'alert');
  await expect(inlineError).toHaveText(
    `«${existingName}» ya es el nombre de otro producto de tu casa.`
  );
  await expect(page.locator('[data-test="gestor-productos-campo-nombre"] input')).toHaveValue(
    draftName
  );
  await expect(page.locator('.alias app-tag')).toContainText(existingName);

  await page.reload();
  await expect(page).toHaveURL(/\/pantry\/products\/new$/);
  const matchingExisting = await productsMatching(page, token, existingName);
  expect(matchingExisting.data).toHaveLength(1);
  expect(matchingExisting.meta.total).toBe(1);
  expect(matchingExisting.data[0]).toMatchObject({
    id: firstProduct.id,
    name: existingName,
    aliases: []
  });
  const matchingDraft = await productsMatching(page, token, draftName);
  expect(matchingDraft.data).toHaveLength(0);
  expect(matchingDraft.meta.total).toBe(0);
  expect(pageErrors).toEqual([]);
});
