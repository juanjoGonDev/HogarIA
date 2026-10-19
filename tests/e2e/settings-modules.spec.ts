import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { assertSwitchGeometry, assertSwitchHitArea } from './helpers/switch-geometry';

test.use({ serviceWorkers: 'block' });

/**
 * Los modulos son un flag de la app: se editan en Configuracion (no en
 * Preferencias, que habla del comensal), se aplican sin recargar y lo que este
 * build aun no trae se puede dejar activado por adelantado sin que nadie se
 * quede con un enlace roto.
 *
 * Se busca por atributos de datos y por href, nunca por el texto: las etiquetas
 * de la seccion pasan por el pipe de i18n y en CI el idioma resuelto no siempre
 * es el castellano en el primer render.
 */
test.describe('Configuración — módulos', () => {
  test('el switch compartido mantiene el thumb centrado y un objetivo táctil de 44 px', async ({
    page
  }, testInfo) => {
    const mobile = testInfo.project.name.startsWith('mobile-');
    const viewport = mobile ? { width: 390, height: 950 } : { width: 1280, height: 970 };
    await page.setViewportSize(viewport);
    await registerAndGoto(page, '/settings', 'shared-switch-geometry');

    const selector = '[data-module-switch="pantry"]';
    await assertSwitchGeometry(page, selector);
    await expect(page.locator(selector)).toHaveAttribute('aria-disabled', 'false');

    await page.getByRole('button', { name: /^(Oscuro|Dark)$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await assertSwitchGeometry(page, selector);
    await page.getByRole('button', { name: /^(Claro|Light)$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    if (mobile) {
      for (const size of [
        { width: 320, height: 568 },
        { width: 568, height: 320 }
      ]) {
        await page.setViewportSize(size);
        await page.locator(selector).scrollIntoViewIfNeeded();
        await assertSwitchHitArea(page, selector);
      }
      await page.setViewportSize(viewport);
    }
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const screenshotDir = join(
      process.cwd(),
      '.e2e-screenshots',
      'household-plan-comparison',
      testInfo.project.name
    );
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: join(screenshotDir, `07-settings-switch-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('lista las cinco secciones y marca las que aún no llegan', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-list');

    await expect(page.locator('.settings-module')).toHaveCount(5);
    // Desde la ## 12aj los tickets llegan en el build: solo queda «pronto» el modulo de tareas.
    await expect(page.locator('.settings-module__soon')).toHaveCount(1);

    // Sin marcar nada, el significado es «todo lo que trae el build»
    await expect(page.locator('[data-module-switch="meals"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.locator('[data-module-switch="pantry"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // La lista de la compra ya existe: viene encendida con las demas del build.
    await expect(page.locator('[data-module-switch="shopping"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // Los tickets (## 12aj) ya vienen con el build: encendidos como el resto.
    await expect(page.locator('[data-module-switch="receipts"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );

    // Y lo dice en texto, para que la regla no sea un misterio
    await expect(
      page.locator('.settings-hint', { hasText: /todas las secciones|every section/i })
    ).toHaveCount(1);
  });

  test('apagar una sección la quita de la navegación sin recargar', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-off');

    await expect(page.locator('a[href="/pantry"]')).not.toHaveCount(0);

    await page.locator('[data-module-switch="pantry"]').click();

    // Seguimos en Configuracion: no hay navegacion ni recarga de por medio
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('a[href="/pantry"]')).toHaveCount(0);
    // El resto convive: el cambio es quirurgico
    await expect(page.locator('a[href="/calendar"]')).not.toHaveCount(0);

    // Persistido: al volver, la seccion sigue apagada
    await page.reload();
    await expect(page.locator('[data-module-switch="pantry"]')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await expect(page.locator('a[href="/pantry"]')).toHaveCount(0);

    await page.locator('[data-module-switch="pantry"]').click();
    await expect(page.locator('a[href="/pantry"]')).not.toHaveCount(0);
  });

  test('activar por adelantado lo que aún no existe no crea rutas muertas', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-soon');

    // El modulo de tareas es el que este build aun no trae (los tickets llegaron en la ## 12aj).
    await page.locator('[data-module-switch="home"]').click();
    await expect(page.locator('[data-module-switch="home"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // Marcado, pero enlazarlo seria un 404: este build no trae la pantalla
    await expect(page.locator('a[href="/tasks"]')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('[data-module-switch="home"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.locator('a[href="/tasks"]')).toHaveCount(0);

    // Y la que si existe no se cayo al cambiar el resto: sigue enlazada
    await expect(page.locator('a[href="/shopping"]')).not.toHaveCount(0);
  });

  test('la última sección visible no se apaga, y se puede restablecer', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/settings', 'mods-last');

    // Hay que apagar las TRES secciones de mas: con cuatro vivas en este build (los
    // tickets llegaron en la ## 12aj), quitar dos deja tres visibles y ninguna al limite.
    for (const module of ['pantry', 'shopping', 'receipts']) {
      const toggle = page.locator(`[data-module-switch="${module}"]`);
      await toggle.evaluate((element) =>
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      );
      const geometry = await toggle.evaluate((element) => {
        const control = element.getBoundingClientRect();
        const launcher = document.querySelector('[data-test="ai-assistant-open"]');
        if (!launcher) return { overlapsLauncher: false, control: null, launcher: null };
        const button = launcher.getBoundingClientRect();
        return {
          overlapsLauncher:
            control.left < button.right &&
            control.right > button.left &&
            control.top < button.bottom &&
            control.bottom > button.top,
          control: {
            left: control.left,
            right: control.right,
            top: control.top,
            bottom: control.bottom
          },
          launcher: {
            left: button.left,
            right: button.right,
            top: button.top,
            bottom: button.bottom
          }
        };
      });
      expect(
        geometry.overlapsLauncher,
        `el FAB no debe cubrir ${module}: ${JSON.stringify(geometry)}`
      ).toBe(false);
      if (module === 'receipts') {
        const screenshotDir = join(
          process.cwd(),
          '.e2e-screenshots',
          'assistant-control-overlap-20261018',
          testInfo.project.name
        );
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({
          path: join(screenshotDir, 'settings-last-module-visible.png'),
          fullPage: false,
          animations: 'disabled'
        });
      }
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
    }

    // Queda una sola: apagarla habria vuelto a encender todas (seleccion vacia)
    await expect(page.locator('[data-module-switch="meals"]')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(page.locator('[data-module-switch="meals"]')).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('a[href="/calendar"]')).not.toHaveCount(0);

    await page.locator('[data-modules-reset]').click();
    await expect(page.locator('[data-module-switch="pantry"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.locator('[data-module-switch="meals"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.locator('[data-modules-reset]')).toHaveCount(0);
  });

  test('el núcleo de la app no se puede apagar', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-core');

    await page.locator('[data-module-switch="pantry"]').click();

    for (const path of ['/dashboard', '/household', '/preferences', '/settings']) {
      // El mensaje va en `expect(x, msg)`: Playwright no acepta `{ message }` como opcion
      // del matcher y lo ignoraba en silencio —el fallo decia «expected not to have count 0»
      // sin decir por cual de las cuatro rutas habia sido.
      await expect(page.locator(`a[href="${path}"]`), `nav roto para ${path}`).not.toHaveCount(0);
    }
  });

  test('los interruptores de módulo responden a Espacio y conservan el foco', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-keyboard-toggle');
    const pantrySwitch = page.locator('[data-module-switch="pantry"]');
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'false');
    await expect(pantrySwitch).toHaveAttribute('tabindex', '0');
    let signalPatch!: () => void;
    let releasePatch!: () => void;
    let patchCount = 0;
    const patchObserved = new Promise<void>((resolve) => {
      signalPatch = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });

    await page.route('**/api/auth/taste*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patchCount += 1;
      signalPatch();
      await responseGate;
      await route.continue();
    });

    await pantrySwitch.focus();

    await page.keyboard.press('Space');
    await patchObserved;
    await expect(pantrySwitch).toHaveAttribute('aria-checked', 'false');
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'true');
    await expect(pantrySwitch).toBeFocused();

    // aria-disabled no quita foco, pero el guard evita una segunda escritura.
    await page.keyboard.press('Space');
    await expect(pantrySwitch).toHaveAttribute('aria-checked', 'false');
    await expect(pantrySwitch).toBeFocused();
    expect(patchCount).toBe(1);
    releasePatch();
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'false');

    await page.keyboard.press('Space');
    await expect(pantrySwitch).toHaveAttribute('aria-checked', 'true');
    await expect(pantrySwitch).toBeFocused();
    await expect.poll(() => patchCount).toBe(2);
  });

  test('no se pueden cambiar módulos hasta cargar el perfil inicial', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-profile-load');

    let signalProfileRequest!: () => void;
    let releaseProfile!: () => void;
    const profileRequest = new Promise<void>((resolve) => {
      signalProfileRequest = resolve;
    });
    const profileResponse = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });

    await page.route('**/api/auth/taste*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      signalProfileRequest();
      await profileResponse;
      await route.continue();
    });

    await page.goto('/settings');
    await profileRequest;

    const pantrySwitch = page.locator('[data-module-switch="pantry"]');
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'true');
    await expect(pantrySwitch).toHaveAttribute('tabindex', '-1');
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'true');
    const screenshotDir = join(
      process.cwd(),
      '.e2e-screenshots',
      'qa-ci-active-contracts',
      test.info().project.name
    );
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: join(screenshotDir, 'settings-profile-loading.png'),
      fullPage: true,
      animations: 'disabled'
    });

    releaseProfile();
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'false');
    await expect(pantrySwitch).toHaveAttribute('tabindex', '0');
    await expect(pantrySwitch).toHaveAttribute('aria-checked', 'true');
    await pantrySwitch.click();
    await expect(pantrySwitch).toHaveAttribute('aria-checked', 'false');
  });

  test('una sección apagada sigue accesible por URL: no se expulsa a nadie', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-direct');

    await page.locator('[data-module-switch="pantry"]').click();
    await expect(page.locator('a[href="/pantry"]')).toHaveCount(0);

    // La ruta sigue viva: solo deja de enseñarse en la navegacion
    await page.goto('/pantry');
    await expect(page).toHaveURL(/\/pantry/);
    await expect(page.locator('app-pantry')).toHaveCount(1);
    await expect(page.locator('a[href="/pantry"]')).toHaveCount(0);
  });

  test('restablecer espera a que termine el guardado actual', async ({ page }) => {
    await registerAndGoto(page, '/settings', 'mods-reset-pending');

    let signalPatch!: () => void;
    let releasePatch!: () => void;
    const patchObserved = new Promise<void>((resolve) => {
      signalPatch = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });

    await page.route('**/api/auth/taste*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch();
      signalPatch();
      await responseGate;
      await route.fulfill({ response });
    });

    const pantrySwitch = page.locator('[data-module-switch="pantry"]');
    await pantrySwitch.click();
    await patchObserved;

    const reset = page.locator('[data-modules-reset]');
    await expect(pantrySwitch).toHaveAttribute('aria-disabled', 'true');
    await expect(reset).toBeDisabled();
    releasePatch();

    await expect(pantrySwitch).toHaveAttribute('aria-checked', 'false');
    await expect(reset).toBeEnabled();
  });

  test('los interruptores conservan un objetivo táctil de 44 px y el layout cabe en los breakpoints', async ({
    page
  }) => {
    await registerAndGoto(page, '/settings', 'mods-responsive-bounds');
    const pantrySwitch = page.locator('[data-module-switch="pantry"]');

    for (const viewport of [
      { width: 320, height: 740 },
      { width: 393, height: 852 },
      { width: 480, height: 852 },
      { width: 481, height: 852 },
      { width: 600, height: 852 },
      { width: 601, height: 852 },
      { width: 767, height: 900 },
      { width: 768, height: 900 },
      { width: 769, height: 900 },
      { width: 852, height: 393 }
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }));
      expect(
        bounds.scrollWidth,
        `sin overflow horizontal a ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(bounds.viewportWidth);
      const box = await pantrySwitch.boundingBox();
      expect(
        box?.height,
        `objetivo táctil a ${viewport.width}×${viewport.height}`
      ).toBeGreaterThanOrEqual(44);
    }
  });
});
