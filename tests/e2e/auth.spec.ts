import { test, expect } from './fixtures';
import { createHousehold, registerUser, logout } from './helpers/auth';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should redirect to login when not authenticated', async ({ page }) => {
    await expect(page).toHaveURL(/.*auth\/login/);
  });

  test('should show login form', async ({ page }) => {
    // Minuscula de frase: la tanda del diccionario (`## 12v`) paso los titulos a `Iniciar sesion` y aqui se
    // afirma lo que la app pinta, no como se llamaba el literal antes de existir el diccionario.
    await expect(page.locator('h2')).toContainText('Iniciar sesión');
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('shows accessible inline validation for empty login fields', async ({ page }) => {
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('#email-error')).toHaveText('El email es requerido');
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email')).toHaveAttribute('aria-describedby', 'email-error');

    await page.locator('#email').fill('login@example.test');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('#password-error')).toHaveText('La contraseña es requerida');
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#password')).toHaveAttribute('aria-describedby', 'password-error');
  });

  test('reveals and hides the password using its accessible toggle', async ({ page }) => {
    const password = page.locator('#password');
    await password.fill('SyntheticPassword123');

    const reveal = page.getByRole('button', { name: 'Mostrar contraseña' });
    await expect(reveal).toBeVisible();
    await reveal.click();
    await expect(password).toHaveAttribute('type', 'text');

    const hide = page.getByRole('button', { name: 'Ocultar contraseña' });
    await hide.click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('shows loading and a recoverable message when the login service is unavailable', async ({
    page
  }) => {
    let releaseResponse!: () => void;
    let markRequestSeen!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestSeen = new Promise<void>((resolve) => {
      markRequestSeen = resolve;
    });

    await page.route('**/api/auth/login', async (route) => {
      markRequestSeen();
      await responseGate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic service outage' })
      });
    });

    await page.locator('#email').fill('login@example.test');
    await page.locator('#password').fill('SyntheticPassword123');
    await page.locator('button[type="submit"]').click();

    try {
      await requestSeen;
      const submit = page.locator('button[type="submit"]');
      await expect(submit).toBeDisabled();
      await expect(page.locator('.btn__spinner')).toBeVisible();
      releaseResponse();

      await expect(page.getByText('Servicio no disponible', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/.*auth\/login/);
      await expect(submit).toBeEnabled();
    } finally {
      releaseResponse();
    }
  });

  test('shows an accessible credential error instead of a stale-session toast', async ({
    page
  }, testInfo) => {
    const email = await registerUser(page, 'Login feedback');
    await createHousehold(page, 'Hogar sintético de feedback de acceso');
    await logout(page);
    await page.fill('input#email', email);
    await page.fill('input#password', 'WrongPassword1');
    await page.locator('#password').press('Enter');

    await expect(page).toHaveURL(/.*auth\/login/);
    await expect(page).not.toHaveURL(/.*dashboard/);
    await expect(page.locator('#password-error')).toHaveText('Credenciales incorrectas');
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/La sesi[oó]n que guarda este navegador ya no vale/i)).toHaveCount(
      0
    );
    await expect(page.locator('#email')).toBeEnabled();
    await expect(page.locator('#password')).toBeEnabled();
    await expect(page.locator('button[type="submit"]')).toBeEnabled();

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: testInfo.outputPath(`login-invalid-credentials-${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled'
    });

    await page.locator('#password').fill('Test1234');
    await page.locator('#password').press('Enter');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('should navigate to register page', async ({ page }) => {
    await page.getByRole('link', { name: /Regístrate/ }).click();

    await expect(page).toHaveURL(/.*auth\/register/);
    await expect(page.locator('h2')).toContainText('Crear Cuenta');
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.getByRole('link', { name: /Olvidaste/ }).click();

    await expect(page).toHaveURL(/.*auth\/forgot-password/);
    await expect(page.locator('h2')).toContainText('Recuperar Contraseña');
  });

  test('should show the register form without the profile questions', async ({ page }) => {
    await page.goto('/auth/register');

    await expect(page.locator('input#name')).toBeVisible();
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();

    // El nivel de cocina se fue del alta: es perfil, se responde en el tour y se
    // edita en Preferencias > Perfil. Aqui solo se crea la cuenta.
    await expect(page.locator('.register-form__option')).toHaveCount(0);
    await expect(page.locator('.register-form__note')).toContainText('cinco cosas cortas');
  });

  test('should login with the credentials used at registration', async ({ page }) => {
    const email = await registerUser(page, 'Login Tester');
    await createHousehold(page, 'Hogar sintético de login');
    await logout(page);

    await page.fill('input#email', email);
    await page.fill('input#password', 'Test1234');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*dashboard/);
  });
});
