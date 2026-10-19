import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

test('el estado sin hogar usa el sistema de iconos y conserva un título limpio', async ({
  page
}) => {
  await registerAndGoto(page, '/household', 'household-empty-icons');
  await expect(page.locator('app-icon.no-household__icon')).toBeVisible();
  await expect(page.locator('.household__title')).toHaveText('Hogar');
  await waitForStableView(page);

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'household-empty.png') });
  }
});

test('los iconos de compartir e invitación no forman parte del texto accesible', async ({
  page
}, testInfo) => {
  const initialViewport = page.viewportSize()!;
  await registerAndGoto(
    page,
    '/household',
    'Miembro sintético con un nombre deliberadamente muy largo para probar el reflujo'
  );
  await page.getByRole('button', { name: 'Crear hogar', exact: true }).click();
  await page.locator('input#householdName').fill('Casa sintética QA');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.locator('.invite-card')).toBeVisible();

  const responsiveViewports = testInfo.project.use.isMobile
    ? [
        { width: 393, height: 851 },
        { width: 320, height: 568 }
      ]
    : [];
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (responsiveViewports.length) {
    const initialLanguage = await page.evaluate(() => localStorage.getItem('hogar:v1:language'));
    for (const language of ['es', 'en']) {
      await page.evaluate((nextLanguage) => {
        localStorage.setItem('hogar:v1:language', nextLanguage);
      }, language);
      await page.goto('/household');
      await expect(page.locator('.invite-card')).toBeVisible();

      for (const viewport of responsiveViewports) {
        await page.locator('[data-test="household-tab-home"]').click();
        await expect(page.locator('.invite-card')).toBeVisible();
        await page.setViewportSize(viewport);
        const linkLayout = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>('.invite-card')!;
          const content = document.querySelector<HTMLElement>('.invite-card__content')!;
          const link = document.querySelector<HTMLElement>('.invite-card__code')!;
          const actions = document.querySelector<HTMLElement>('.invite-card__actions')!;
          const bounds = (element: HTMLElement) => {
            const { left, right } = element.getBoundingClientRect();
            return { left, right };
          };
          return {
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            linkWidth: link.clientWidth,
            linkScrollWidth: link.scrollWidth,
            card: bounds(card),
            content: bounds(content),
            link: bounds(link),
            actions: bounds(actions)
          };
        });
        expect(
          linkLayout.documentWidth,
          'la pantalla no debe desbordarse horizontalmente'
        ).toBeLessThanOrEqual(linkLayout.viewportWidth);
        expect(
          linkLayout.linkScrollWidth,
          'el enlace debe envolver dentro de su tarjeta'
        ).toBeLessThanOrEqual(linkLayout.linkWidth);
        expect(
          linkLayout.link.right,
          'el enlace debe permanecer dentro de la tarjeta'
        ).toBeLessThanOrEqual(linkLayout.card.right);
        expect(
          linkLayout.actions.right,
          'los botones de copiar y regenerar deben permanecer visibles dentro de la tarjeta'
        ).toBeLessThanOrEqual(linkLayout.card.right);

        await page.goto('/household?tab=members');
        await expect(page.locator('.member-card')).toBeVisible();
        const memberLayout = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>('.member-card')!;
          const info = card.querySelector<HTMLElement>('.member-card__info')!;
          const name = card.querySelector<HTMLElement>('.member-card__name')!;
          const email = card.querySelector<HTMLElement>('.member-card__email')!;
          const meta = card.querySelector<HTMLElement>('.member-card__meta')!;
          const bounds = (element: HTMLElement) => {
            const { left, right } = element.getBoundingClientRect();
            return { left, right };
          };
          return {
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            card: bounds(card),
            info: bounds(info),
            infoScrollWidth: info.scrollWidth,
            infoClientWidth: info.clientWidth,
            name: bounds(name),
            nameScrollWidth: name.scrollWidth,
            nameClientWidth: name.clientWidth,
            email: bounds(email),
            emailScrollWidth: email.scrollWidth,
            emailClientWidth: email.clientWidth,
            meta: bounds(meta)
          };
        });
        expect(
          memberLayout.documentWidth,
          'la fila de miembro no debe crear overflow horizontal del documento'
        ).toBeLessThanOrEqual(memberLayout.viewportWidth);
        expect(
          memberLayout.info.right,
          'el nombre y correo deben permanecer dentro de la tarjeta'
        ).toBeLessThanOrEqual(memberLayout.card.right);
        expect(
          memberLayout.infoScrollWidth,
          'el contenido de nombre/correo no debe recortarse dentro de su columna'
        ).toBeLessThanOrEqual(memberLayout.infoClientWidth);
        expect(
          memberLayout.name.right,
          'el nombre debe permanecer dentro de la tarjeta'
        ).toBeLessThanOrEqual(memberLayout.card.right);
        expect(
          memberLayout.nameScrollWidth,
          'el nombre largo debe envolver sin recortarse'
        ).toBeLessThanOrEqual(memberLayout.nameClientWidth);
        expect(
          memberLayout.emailScrollWidth,
          'el correo debe envolver sin recortarse'
        ).toBeLessThanOrEqual(memberLayout.emailClientWidth);
        expect(
          memberLayout.meta.right,
          'las insignias de rol/nivel deben permanecer dentro de la tarjeta'
        ).toBeLessThanOrEqual(memberLayout.card.right);

        if (screenshotDirectory) {
          mkdirSync(screenshotDirectory, { recursive: true });
          await page.locator('.member-card__meta').scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(
              screenshotDirectory,
              `household-members-${language}-${viewport.width}x${viewport.height}.png`
            )
          });
        }
      }
    }
    await page.evaluate((language) => {
      if (language === null) localStorage.removeItem('hogar:v1:language');
      else localStorage.setItem('hogar:v1:language', language);
    }, initialLanguage);
    await page.goto('/household');
    await expect(page.locator('.invite-card')).toBeVisible();
  }
  await page.setViewportSize(initialViewport);
  await waitForStableView(page);

  const copyLink = page.getByRole('button', { name: 'Copiar enlace', exact: true });
  await expect(copyLink).toBeVisible();
  await expect(copyLink.locator('app-icon')).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyLink.click();
  const inviteLink = (await page.locator('.invite-card__code').textContent())?.trim();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);

  const regenerate = page.getByRole('button', { name: 'Regenerar', exact: true });
  const linkBeforeRegeneration = await page.locator('.invite-card__code').textContent();
  await regenerate.click();
  await expect(page.locator('.invite-card__code')).not.toHaveText(linkBeforeRegeneration ?? '');

  await expect(page.locator('.household__title')).toHaveText('Hogar');
  await page.getByRole('tab', { name: 'Ajustes' }).click();
  const shareTitle = page
    .locator('.settings-section__title')
    .filter({ hasText: 'Compartir en el hogar' });
  await expect(shareTitle).toHaveText('Compartir en el hogar');
  await expect(shareTitle.locator('app-icon')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Salir del hogar', exact: true })).toBeVisible();
  while (await page.locator('.toast__close').count()) {
    await page.locator('.toast__close').first().click();
  }

  await page.getByRole('tab', { name: 'Miembros' }).click();
  await expect(page.locator('.member-card')).toBeVisible();
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'household-members.png') });
  }

  await page.getByRole('button', { name: /Invitar/ }).click();
  const copyCode = page.getByRole('button', { name: 'Copiar', exact: true });
  await expect(copyCode).toBeVisible();
  await expect(copyCode.locator('app-icon')).toBeVisible();
  await waitForStableView(page);

  if (screenshotDirectory) {
    await page.screenshot({ path: join(screenshotDirectory, 'household-invite-modal.png') });
  }
});

test('los iconos decorativos de Dashboard usan SVG, incluida la métrica de miembros', async ({
  page
}) => {
  await registerAndGoto(page, '/dashboard', 'dashboard-svg-icons');
  await waitForStableView(page);

  await expect.soft(page.locator('.stat-card__icon app-icon')).toHaveCount(4);
  await expect.soft(page.locator('.action-card__icon app-icon')).toHaveCount(3);
  expect.soft(await page.locator('.empty-state__icon app-icon').count()).toBeGreaterThan(0);
  const memberStat = page.locator('.stat-card').filter({ hasText: 'Miembros' });
  await expect.soft(memberStat.locator('.stat-card__icon app-icon')).toBeVisible();

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'dashboard-icons.png') });
  }
});
