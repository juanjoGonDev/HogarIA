import { Page, expect } from '@playwright/test';

import { test as base } from '@playwright/test';
import { dataSeed, seededEmail } from './seed';

const TEST_PASSWORD = 'Test1234';

/**
 * Cada prueba registra su propio usuario para no pisarse entre si. El correo
 * lleva la semilla del run: las filas de la base de datos se pueden atribuir a
 * una ejecucion concreta, y el reporter lo muestra en la linea del test.
 */
function generatedEmail(): string {
  const email = seededEmail();
  const info = base.info();
  if (info) info.annotations.push({ type: 'seed', description: dataSeed(email) });
  return email;
}

/** El registro termina en el gate obligatorio del hogar, onboarding o dashboard. */
function waitAfterRegister(page: Page, timeout: number): Promise<boolean> {
  return page
    .waitForURL(/.*(dashboard|onboarding|household)/, { timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * Rellena y envia el alta, y espera a la redireccion.
 *
 * El alta contesta en milisegundos cuando va mal (409 de correo repetido, 429 de
 * rate limit por IP - la suite entera comparte ventana). Esperar entonces a la
 * redireccion era lo que convertia un problema de datos en dos minutos de nada:
 * aqui se captura la respuesta y se devuelve su estado para que quien llama
 * reintente con otra direccion o falle ya, con el codigo en el mensaje.
 */
async function submitRegister(
  page: Page,
  name: string,
  email: string
): Promise<{ ok: boolean; status?: number }> {
  await page.goto('/auth/register');

  // El formulario hay que ESPERARLO: en el runner de CI el SPA aun se esta
  // pintando cuando termina el 'load', y mirar una sola vez (isVisible) perdia
  // el envio entero: la prueba no registraba a nadie y se comia sus 45s de
  // espera, uno detras de otro, hasta convertir 5 fallos reales en 69.
  const form = page.locator('input#name');
  const hasForm = await form
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!hasForm) return { ok: await waitAfterRegister(page, 15000) };

  const pending = page
    .waitForResponse((response) => response.url().includes('/api/auth/register'), {
      timeout: 20000
    })
    .catch(() => null);

  await form.fill(name);
  await page.fill('input#email', email);
  await page.fill('input#password', TEST_PASSWORD);
  await page.fill('input#confirm-password', TEST_PASSWORD);
  await page.click('button[type="submit"]');

  const response = await pending;
  if (response && !response.ok()) return { ok: false, status: response.status() };

  // 2xx: como mucho la navegacion llega tarde, y eso se espera una vez.
  return { ok: await waitAfterRegister(page, 45000), status: response?.status() };
}

/**
 * El registro pasa por la configuración inicial (alergias, gustos, objetivo y
 * utensilios). La mayoría de tests no quieren ese formulario: lo saltan y se
 * quedan en el dashboard.
 */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.waitForURL(/.*(dashboard|onboarding|household)/, { timeout: 45000 });
  if (page.url().includes('/household')) {
    await expect(page.locator('.no-household')).toBeVisible({ timeout: 45000 });
    return;
  }
  if (!page.url().includes('/onboarding')) return;

  await page.getByRole('button', { name: /Saltar por ahora/i }).click();
  await page.waitForURL(/.*dashboard/, { timeout: 45000 });
}

/** Registra un usuario nuevo y espera su setup obligatorio sin saltarlo. */
export async function registerToOnboarding(
  page: Page,
  name = 'E2E',
  email?: string
): Promise<string> {
  const tried: string[] = [];
  let target = email ?? generatedEmail();
  let outcome = await submitRegister(page, name, target);

  if (!outcome.ok && !email) {
    // Con otra direccion: la anterior puede no haberse registrado nunca (o estar
    // registrada por un reintento anterior del mismo test).
    tried.push(`${target} -> ${outcome.status ?? 'sin respuesta'}`);
    target = generatedEmail();
    outcome = await submitRegister(page, name, target);
  }
  if (!outcome.ok) {
    tried.push(`${target} -> ${outcome.status ?? 'sin respuesta'}`);
    throw new Error(
      `El registro de la prueba no ha llegado al onboarding (${page.url()}). Intentos: ${tried.join(', ')}`
    );
  }

  await expect(page).toHaveURL(/.*(dashboard|onboarding|household)/);
  return target;
}

/**
 * Registra un usuario nuevo (email unico) y lo deja autenticado en el
 * dashboard. Los tests no comparten usuario para no pisarse entre si.
 */
export async function registerUser(page: Page, name = 'E2E', email?: string): Promise<string> {
  const created = await registerToOnboarding(page, name, email);
  await skipOnboarding(page);
  return created;
}

/**
 * Crea un hogar. Es necesario para que el backend siembre los ingredientes
 * comunes (~68) y los utensilios (~54) del catalogo.
 */
export async function createHousehold(page: Page, name = 'Hogar E2E'): Promise<void> {
  await page.goto('/household');
  await expect(page.locator('.no-household')).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: /Crear hogar/i }).click();
  await page.fill('input#householdName', name);
  await page.locator('app-modal button[type="submit"]').click();
  await expect(page.locator('.invite-card__code')).toContainText('/invite/', { timeout: 45000 });
}

/** Registra un usuario, crea su hogar y lo deja en `path`. */
export async function registerWithHousehold(page: Page, path: string, name = 'E2E'): Promise<void> {
  await registerUser(page, name);
  await createHousehold(page);
  await page.goto(path);
}

/** Registra un usuario y prepara un hogar al abrir rutas protegidas. */
export async function registerAndGoto(page: Page, path: string, name = 'E2E'): Promise<string> {
  const email = await registerUser(page, name);
  if (!/^\/household(?:$|[/?#])/.test(path)) await createHousehold(page);
  await page.goto(path);
  return email;
}

/** Cierra la sesion (limpia el almacenamiento local) y vuelve al login. */
export async function logout(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
  await page.goto('/auth/login');
}
