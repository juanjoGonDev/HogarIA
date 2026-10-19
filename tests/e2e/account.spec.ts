import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Page, expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

/**
 * La cuenta de la persona, en su pagina (ronda 13). Hasta aqui vivia dentro de Preferencias, que
 * es del comensal —alergias, gustos, objetivo—, y las dos cosas no se parecen en nada: se entra
 * pulsando tu propia cara del menu, no buscando el ajo. Se prueba contra el servidor real, porque
 * media pantalla es un fichero en `uploads/`.
 */

async function syntheticAvatarPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el fixture sintético del avatar');

    context.fillStyle = '#d95d39';
    context.fillRect(0, 0, 128, 192);
    context.fillStyle = '#355070';
    context.fillRect(128, 0, 128, 192);
    context.fillStyle = '#f6bd60';
    context.beginPath();
    context.arc(192, 96, 48, 0, Math.PI * 2);
    context.fill();

    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

async function addOneItem(page: Page, name: string, item: string): Promise<void> {
  await registerAndGoto(page, '/shopping', name);
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('La compra');
  await page.locator('[data-test="create-submit"]').click();
  await page.locator('[data-test="add-input"]').fill(item);
  await page.locator('[data-test="add-submit"]').click();
}

function profileEntryAction(page: Page) {
  const width = page.viewportSize()?.width ?? 1024;
  return page.locator(width < 1024 ? '.header__profile' : '.sidebar__account-main');
}

test.describe('Mi cuenta', () => {
  test('tiene pagina propia, y se entra por la cara del menu', async ({ page }, testInfo) => {
    await registerAndGoto(page, '/dashboard', 'acct-entry');

    // El avatar del menu es la puerta: lleva a la cuenta, no a las preferencias del comensal.
    await profileEntryAction(page).click();
    await expect(page).toHaveURL(/\/account$/);

    // Tres sub-secciones, la primera por defecto y sin ensuciar la URL.
    await expect(page.locator('.tab')).toHaveCount(3);
    await expect(page.locator('.tab--active')).toContainText('Cuenta');
    await expect(page).not.toHaveURL(/tab=/);

    await page.locator('[data-test="account-tab-security"]').click();
    await expect(page).toHaveURL(/[?&]tab=security/);
    const infoTab = page.locator('[data-test="account-tab-info"]');
    await expect(infoTab).toContainText('Información');
    await infoTab.click();
    await expect(page).toHaveURL(/[?&]tab=info/);
    await expect(page.locator('[data-test="account-email"]')).toContainText('@');

    if (process.env.E2E_CAPTURE_QA_SCREENSHOTS === '1') {
      const viewport =
        testInfo.project.name === 'chromium'
          ? { width: 1440, height: 900 }
          : { width: 393, height: 851 };
      const screenshotDirectory = join(
        process.cwd(),
        '.e2e-screenshots',
        'qa-account-tabs-20261001'
      );
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: join(screenshotDirectory, `account-info-${testInfo.project.name}.png`),
        animations: 'disabled'
      });
    }

    await page.reload();
    await expect(page.locator('.tab--active')).toContainText('Información');

    // La de la cuenta es una pestaña con controles propios, y el enlace al comensal esta ahi.
    await page.locator('[data-test="account-tab-account"]').click();
    await expect(page.locator('[data-test="account-name"]')).toBeVisible();
    await expect(page.locator('a[href="/preferences"]')).not.toHaveCount(0);
  });

  test('renombrarse se ve en el menu y en el historial, sin recargar', async ({ page }) => {
    await addOneItem(page, 'acct-hist', 'Leche');
    await page.getByRole('button', { name: 'Quien ha tocado que' }).click();
    const row = page.locator('[data-test="audit-row"]').first();
    await expect(row).toContainText('acct-hist');
    await page.locator('[data-test="audit-close"]').click();

    await page.goto('/account');
    await page.locator('[data-test="account-name"]').fill('Ana Belen');
    await page.locator('[data-test="account-name-save"]').click();
    await expect(
      page.locator('.toast--success').filter({ hasText: 'Nombre guardado' })
    ).toBeVisible();

    // El menu ya la llama asi (misma senal que el historial, no dos copias que se separan).
    await expect(page.locator('.sidebar__account-name')).toHaveText('Ana Belen');

    // Y la fila del historial, sin refrescar la lista: es tu linea, y decir «Ana ha anadido»
    // mientras la pantalla entera te llama de otra forma es el fallo que esto cierra.
    await page.goto('/shopping');
    await page.locator('[data-test="list-row"]').getByRole('link').click();
    await page.locator('[data-test="item-row"]').first().click();
    await page.getByRole('button', { name: 'Quien ha tocado que' }).click();
    await expect(page.locator('[data-test="audit-row"]').first()).toContainText('Ana Belen');
    await expect(page.locator('[data-test="audit-row"]').first()).not.toContainText('acct-hist');
  });

  test('la cara se toca: hover, modal, encuadre y foto en todos lados', async ({ page }) => {
    await registerAndGoto(page, '/account', 'acct-photo');
    const avatarPng = await syntheticAvatarPng(page);

    // El disco con la inicial: tinta sobre fondo, no sobre el fondo de la pagina (que era el
    // fallo: una letra del mismo color que su propio circulo).
    const disc = page.locator('[data-test="account-avatar"] .avatar');
    const { background, ink } = await disc.evaluate((el) => {
      const style = getComputedStyle(el);
      const letters = el.querySelector('.avatar__initials');
      return {
        background: style.backgroundColor,
        ink: letters ? getComputedStyle(letters).color : ''
      };
    });
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    expect(ink).toBeTruthy();
    expect(ink).not.toBe(background);

    // Con puntero el affordance aparece en hover; en tacto se queda visible porque no hay hover.
    const edit = page.locator('[data-test="account-avatar-edit"]');
    const hoverAvailable = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    if (hoverAvailable) {
      await expect(edit).toHaveCSS('opacity', '0');
      await page.locator('[data-test="account-avatar-button"]').hover();
      await expect(edit).toHaveCSS('opacity', '1');
    } else {
      await expect(edit).toHaveCSS('opacity', '1');
    }

    await page.locator('[data-test="account-avatar-button"]').click();
    await expect(page.locator('[data-test="account-photo-label"]')).toBeVisible();
    // Sin foto no hay nada que quitar: el boton de quite no se inventa.
    await expect(page.locator('[data-test="account-photo-remove"]')).toHaveCount(0);

    await page.locator('[data-test="account-photo"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: avatarPng
    });
    await expect(page.locator('[data-test="avatar-stage"]')).toBeVisible();

    // Encuadrar: acercar cambia lo que se ve dentro del cuadro. La prueba es el estilo del `img`,
    // que sale de la MISMA region que se va a recortar (avatar-crop) —si el estilo no se mueve, el
    // recorte tampoco.
    const preview = page.locator('[data-test="avatar-stage"] img');
    const before = await preview.getAttribute('style');
    await page.locator('[data-test="avatar-zoom-in"]').click();
    await page.locator('[data-test="avatar-zoom-in"]').click();
    await expect.poll(() => preview.getAttribute('style')).not.toBe(before);
    await page.locator('[data-test="avatar-recenter"]').click();

    // Y Cancelar en el editor no sube nada: vuelve al paso anterior, con la eleccion deshecha.
    await page.locator('[data-test="avatar-editor-cancel"]').click();
    await expect(page.locator('[data-test="account-photo-label"]')).toBeVisible();

    await page.locator('[data-test="account-photo"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: avatarPng
    });
    await page.locator('[data-test="avatar-editor-use"]').click();
    await expect(
      page.locator('.toast--success').filter({ hasText: 'Imagen cambiada' })
    ).toBeVisible();

    // El modal se cierra despues de subir (el editor se va con el): si se queda abierto con la
    // foto ya guardada dentro, la pantalla miente sobre en que paso esta.
    await expect(page.locator('[data-test="avatar-editor-use"]')).toHaveCount(0);

    // El editor SIEMPRE entrega JPEG cuadrado de 128: la URL lo dice, y es la prueba de que el
    // recorte llego al servidor y no solo al canvas.
    const photo = page.locator('[data-test="account-avatar"] img');
    await expect(photo).toHaveAttribute('src', /^\/api\/uploads\/avatars\/.+\.jpg$/);
    await expect
      .poll(() => photo.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        timeout: 15_000
      })
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        photo.evaluate(
          (el) =>
            `${(el as HTMLImageElement).naturalWidth}x${(el as HTMLImageElement).naturalHeight}`
        )
      )
      .toBe('128x128');

    // La foto necesita anillo: sobre una tarjeta blanca dejaba de ser un circulo.
    await expect(disc).not.toHaveCSS('box-shadow', 'none');

    // La misma cara en los dos sitios donde vive: el menu y la cabecera del movil.
    await expect(page.locator('.sidebar__account app-avatar img')).toHaveCount(1);
    await expect(page.locator('.header__profile app-avatar img')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('[data-test="account-avatar"] .avatar--photo')).toBeVisible();

    // Quitar se hace en el mismo modal, y ahora si que existe el boton de quite.
    await page.locator('[data-test="account-avatar-button"]').click();
    await page.locator('[data-test="account-photo-remove"]').click();
    await expect(page.locator('[data-test="account-avatar"] img')).toHaveCount(0);
    await expect(page.locator('[data-test="account-avatar"] .avatar__initials')).toBeVisible();
    await expect(
      page.locator('.toast--success').filter({ hasText: 'Imagen quitada' })
    ).toBeVisible();
  });

  test('los errores de avatar quedan visibles y permiten reintentar la subida', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    await registerAndGoto(page, '/account', 'acct-photo-retry');
    const avatarPng = await syntheticAvatarPng(page);
    await page.locator('[data-test="account-avatar-button"]').click();

    let avatarAttempts = 0;
    await page.route('**/api/auth/avatar', async (route) => {
      avatarAttempts += 1;
      if (avatarAttempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'UPLOAD_WRITE_FAILED' })
        });
        return;
      }
      await route.continue();
    });

    // Formato y tamaño se validan antes de entrar al editor: el error es accionable y ninguno de
    // los dos archivos inválidos debe salir del dispositivo.
    await page.locator('[data-test="account-photo"]').setInputFiles({
      name: 'foto.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
    });
    await expect(page.locator('[data-test="account-photo-error"]')).toContainText(
      'Puede ser JPEG, PNG o WebP.'
    );
    await expect(page.locator('[data-test="avatar-stage"]')).toHaveCount(0);
    await expect(page.locator('[data-test="account-photo-error"]')).toHaveAttribute(
      'role',
      'alert'
    );

    await page.locator('[data-test="account-photo"]').setInputFiles({
      name: 'demasiado-grande.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(4 * 1024 * 1024 + 1)
    });
    await expect(page.locator('[data-test="account-photo-error"]')).toContainText('pesa demasiado');
    await expect(page.locator('[data-test="avatar-stage"]')).toHaveCount(0);
    expect(avatarAttempts).toBe(0);

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR
      ? resolve(process.env.E2E_SCREENSHOT_DIR)
      : null;
    const captureAvatarState = async (state: 'editor' | 'upload-error') => {
      if (!screenshotDirectory) return;
      const viewport =
        testInfo.project.name === 'chromium'
          ? { width: 1440, height: 900 }
          : { width: 393, height: 851 };
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `account-avatar-${state}-${testInfo.project.name}.png`),
        animations: 'disabled'
      });
    };

    await page.locator('[data-test="account-photo"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: avatarPng
    });
    await expect(page.locator('[data-test="avatar-stage"]')).toBeVisible();
    await captureAvatarState('editor');
    const firstUpload = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/avatar') && response.request().method() === 'POST'
    );
    await page.locator('[data-test="avatar-editor-use"]').click();
    expect((await firstUpload).status()).toBe(500);

    // Un fallo de red/servidor no debe ocultarse dentro del paso de recorte: conserva el recorte
    // para que la misma acción pueda reintentarse sin volver a elegir ni encuadrar la foto.
    await expect(page.locator('[data-test="account-photo-error"]')).toContainText(
      'No se pudo subir la foto'
    );
    await expect(page.locator('[data-test="account-photo-error"]')).toHaveAttribute(
      'role',
      'alert'
    );
    await expect(page.locator('[data-test="avatar-stage"]')).toBeVisible();
    await captureAvatarState('upload-error');

    // El error está en el contenido desplazable del modal: que siga dentro del viewport aunque
    // el editor ocupe más que una pantalla en vertical/horizontal o en un breakpoint de shell.
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 559, height: 568 },
      { width: 560, height: 568 },
      { width: 561, height: 568 },
      { width: 568, height: 320 },
      { width: 1023, height: 768 },
      { width: 1024, height: 768 },
      { width: 1025, height: 768 }
    ]) {
      await page.setViewportSize(viewport);
      const modalBody = page.locator('.modal__body');
      await modalBody.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.locator('[data-test="account-photo-error"]')).toBeInViewport();
      const layout = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('.modal__body')!;
        const error = document.querySelector<HTMLElement>('[data-test="account-photo-error"]')!;
        const bodyRect = body.getBoundingClientRect();
        const errorRect = error.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyLeft: bodyRect.left,
          bodyRight: bodyRect.right,
          bodyTop: bodyRect.top,
          bodyBottom: bodyRect.bottom,
          errorLeft: errorRect.left,
          errorRight: errorRect.right,
          errorTop: errorRect.top,
          errorBottom: errorRect.bottom
        };
      });
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.errorLeft).toBeGreaterThanOrEqual(layout.bodyLeft);
      expect(layout.errorRight).toBeLessThanOrEqual(layout.bodyRight);
      expect(layout.errorTop).toBeGreaterThanOrEqual(layout.bodyTop);
      expect(layout.errorBottom).toBeLessThanOrEqual(layout.bodyBottom);
    }

    const retryUpload = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/avatar') && response.request().method() === 'POST'
    );
    await page.locator('[data-test="avatar-editor-use"]').click();
    expect((await retryUpload).status()).toBe(200);
    await expect(page.locator('[data-test="account-photo-error"]')).toHaveCount(0);
    await expect(page.locator('[data-test="avatar-editor-use"]')).toHaveCount(0);
    await expect(page.locator('[data-test="account-avatar"] img')).toBeVisible();
    expect(avatarAttempts).toBe(2);
    expect(pageErrors).toEqual([]);
  });

  test('la contrasena se cambia aqui, y Cancelar limpia los tres campos', async ({
    page
  }, testInfo) => {
    const email = await registerAndGoto(page, '/account?tab=security', 'acct-pass');
    await expect(page.locator('.tab--active')).toContainText('Seguridad');
    const passwordSaveButton = page.locator('[data-test="account-password-save"] button');

    await expect(passwordSaveButton).toBeDisabled();
    await page.locator('[data-test="account-password-current"]').fill('ClaveFalsa1');
    await page.locator('[data-test="account-password-new"]').fill('Nueva1234');
    await page.locator('[data-test="account-password-repeat"]').fill('Nueva1234');
    await expect(passwordSaveButton).toBeEnabled();

    // No coinciden: se dice aqui, antes de llamar a nadie.
    await page.locator('[data-test="account-password-repeat"]').fill('Otra12345');
    await passwordSaveButton.click();
    await expect(page.locator('[data-test="account-password-error"]')).toContainText(
      'no coinciden'
    );

    // Floja: la regla es la del servidor, contada en la pantalla.
    await page.locator('[data-test="account-password-new"]').fill('nova');
    await page.locator('[data-test="account-password-repeat"]').fill('nova');
    await passwordSaveButton.click();
    await expect(page.locator('[data-test="account-password-error"]')).toContainText('mayuscula');

    // Con la actual equivocada, lo que contesta el servidor, traducido.
    await page.locator('[data-test="account-password-new"]').fill('Nueva1234');
    await page.locator('[data-test="account-password-repeat"]').fill('Nueva1234');
    const wrongCurrentPasswordResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/change-password') &&
        response.request().method() === 'POST'
    );
    await passwordSaveButton.click();
    const response = await wrongCurrentPasswordResponse;
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Current password is incorrect'
    });
    await expect(page.locator('[data-test="account-password-error"]')).toContainText(
      'La contrasena actual no es esa'
    );
    expect(
      await page
        .locator('.toast--error .toast__message')
        .filter({ hasText: 'Current password is incorrect' })
        .count()
    ).toBe(0);

    if (process.env.E2E_CAPTURE_QA_SCREENSHOTS === '1') {
      const viewport =
        testInfo.project.name === 'chromium'
          ? { width: 1440, height: 900 }
          : { width: 393, height: 851 };
      const screenshotDirectory = join(
        process.cwd(),
        '.e2e-screenshots',
        'qa-account-password-20261001'
      );
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: join(screenshotDirectory, `account-password-error-${testInfo.project.name}.png`),
        animations: 'disabled'
      });
    }

    await page.locator('[data-test="account-password-cancel"]').click();
    await expect(page.locator('[data-test="account-password-current"]')).toHaveValue('');
    await expect(page.locator('[data-test="account-password-new"]')).toHaveValue('');
    await expect(page.locator('[data-test="account-password-repeat"]')).toHaveValue('');

    // El camino correcto también termina en el servidor, vacía el borrador y mantiene la sesión.
    await page.locator('[data-test="account-password-current"]').fill('Test1234');
    await page.locator('[data-test="account-password-new"]').fill('Nueva1234');
    await page.locator('[data-test="account-password-repeat"]').fill('Nueva1234');
    await page.route('**/api/auth/change-password', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.continue();
    });
    const successfulPasswordChange = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/change-password') &&
        response.request().method() === 'POST'
    );
    await passwordSaveButton.click();
    await expect(passwordSaveButton).toBeDisabled();
    const success = await successfulPasswordChange;
    expect(success.status()).toBe(200);
    await expect(
      page.locator('.toast--success').filter({ hasText: 'Contrasena cambiada' })
    ).toBeVisible();
    await expect(page.locator('[data-test="account-password-current"]')).toHaveValue('');
    await expect(page.locator('[data-test="account-password-new"]')).toHaveValue('');
    await expect(page.locator('[data-test="account-password-repeat"]')).toHaveValue('');

    const oldLogin = await page.request.post('/api/auth/login', {
      data: { email, password: 'Test1234' }
    });
    const newLogin = await page.request.post('/api/auth/login', {
      data: { email, password: 'Nueva1234' }
    });
    expect(oldLogin.status()).toBe(401);
    expect(newLogin.status()).toBe(200);
  });

  test('informacion dice lo que la app guarda en este navegador', async ({ page }) => {
    const email = await registerAndGoto(page, '/account?tab=info', 'acct-info');

    // El arnés genera una cuenta por test (dominio `@example.com`, con el run id dentro para que dos workers no
    // se pisen), asi que lo que se comprueba es QUE se ve la cuenta de esta sesion, no un dominio fijo que ya
    // no existe: `account-email` tiene que decir exactamente lo que `registerAndGoto` registro.
    await expect(page.locator('[data-test="account-email"]')).toContainText(email);
    await expect(page.locator('[data-test="account-version"]')).toContainText('1.');
    // El tamano se dice en unidades legibles, y la cola de escribiras se ve aunque este vacia.
    await expect(page.locator('[data-test="account-storage"]')).toContainText(/B|KB|MB/);
    await expect(page.locator('[data-test="account-pending"]')).toContainText('Nada pendiente');
    await expect(page.locator('[data-test="account-level-link"]')).toContainText(/[A-Za-zÁÉÍÓÚñ]/);

    // Cerrar sesion es real: te saca de la pantalla.
    await page.locator('.tab', { hasText: 'Seguridad' }).click();
    await page.locator('[data-test="account-logout"]').click();
    await expect(page).not.toHaveURL(/\/account/);
  });
});
