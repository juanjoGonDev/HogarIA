import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Locator, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 767, height: 1024 },
  { width: 768, height: 1024 },
  { width: 769, height: 1024 },
  { width: 1440, height: 900 }
];

type Box = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
type ModalShell = {
  viewport: { width: number; height: number; scrollWidth: number };
  overlay: {
    position: string;
    box: Box;
    padding: [string, string, string, string];
  };
  dialog: {
    className: string;
    box: Box;
    maxWidth: string;
    maxHeight: string;
    borderRadius: string;
    flexDirection: string;
  };
  header: { padding: [string, string, string, string]; borderBottomWidth: string };
  title: { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string };
  body: {
    padding: [string, string, string, string];
    overflowY: string;
    overscrollBehaviorY: string;
    clientHeight: number;
    scrollHeight: number;
  };
  close: { box: Box; borderRadius: string };
};

async function waitForLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function waitForModalAnimation(dialog: Locator): Promise<void> {
  await expect
    .poll(() =>
      dialog.evaluate((element) =>
        element.getAnimations().every(({ playState }) => playState !== 'running')
      )
    )
    .toBe(true);
}

async function inspectModal(dialog: Locator): Promise<ModalShell> {
  return dialog.evaluate((element) => {
    const overlay = element.closest<HTMLElement>('.modal-overlay');
    const header = element.querySelector<HTMLElement>('.modal__header');
    const title = element.querySelector<HTMLElement>('.modal__title');
    const body = element.querySelector<HTMLElement>('.modal__body');
    const close = element.querySelector<HTMLElement>('.modal__close');
    if (!overlay || !header || !title || !body || !close) {
      throw new Error('El shell modal compartido está incompleto');
    }

    const round = (value: number) => Math.round(value * 100) / 100;
    const box = (node: Element): Box => {
      const rect = node.getBoundingClientRect();
      return {
        left: round(rect.left),
        top: round(rect.top),
        right: round(rect.right),
        bottom: round(rect.bottom),
        width: round(rect.width),
        height: round(rect.height)
      };
    };
    const padding = (node: HTMLElement): [string, string, string, string] => {
      const style = getComputedStyle(node);
      return [
        style.paddingBlockStart,
        style.paddingInlineEnd,
        style.paddingBlockEnd,
        style.paddingInlineStart
      ];
    };
    const dialogStyle = getComputedStyle(element);
    const overlayStyle = getComputedStyle(overlay);
    const headerStyle = getComputedStyle(header);
    const titleStyle = getComputedStyle(title);
    const bodyStyle = getComputedStyle(body);

    return {
      viewport: {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth
      },
      overlay: {
        position: overlayStyle.position,
        box: box(overlay),
        padding: padding(overlay)
      },
      dialog: {
        className: element.className,
        box: box(element),
        maxWidth: dialogStyle.maxWidth,
        maxHeight: dialogStyle.maxHeight,
        borderRadius: dialogStyle.borderTopLeftRadius,
        flexDirection: dialogStyle.flexDirection
      },
      header: {
        padding: padding(header),
        borderBottomWidth: headerStyle.borderBottomWidth
      },
      title: {
        fontFamily: titleStyle.fontFamily,
        fontSize: titleStyle.fontSize,
        fontWeight: titleStyle.fontWeight,
        lineHeight: titleStyle.lineHeight
      },
      body: {
        padding: padding(body),
        overflowY: bodyStyle.overflowY,
        overscrollBehaviorY: bodyStyle.overscrollBehaviorY,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight
      },
      close: {
        box: box(close),
        borderRadius: getComputedStyle(close).borderTopLeftRadius
      }
    };
  });
}

function assertModalFits(shell: ModalShell, expectedMaxWidth: string): void {
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = shell.overlay.padding.map(
    (value) => Number.parseFloat(value)
  );
  const maxWidth = Number.parseFloat(expectedMaxWidth);
  const availableWidth = shell.viewport.width - paddingLeft - paddingRight;
  expect(shell.dialog.maxWidth).toBe(expectedMaxWidth);
  expect(shell.dialog.box.width).toBeCloseTo(Math.min(maxWidth, availableWidth), 1);
  expect(shell.overlay.position).toBe('fixed');
  expect(shell.overlay.box.left).toBe(0);
  expect(shell.overlay.box.top).toBe(0);
  expect(shell.overlay.box.width).toBe(shell.viewport.width);
  expect(shell.overlay.box.height).toBe(shell.viewport.height);
  expect(shell.dialog.box.left).toBeGreaterThanOrEqual(paddingLeft - 1);
  expect(shell.dialog.box.right).toBeLessThanOrEqual(shell.viewport.width - paddingRight + 1);
  expect(shell.dialog.box.top).toBeGreaterThanOrEqual(paddingTop - 1);
  expect(shell.dialog.box.bottom).toBeLessThanOrEqual(shell.viewport.height - paddingBottom + 1);
  expect(shell.viewport.scrollWidth).toBeLessThanOrEqual(shell.viewport.width + 1);
  expect(shell.close.box.width).toBeGreaterThanOrEqual(44);
  expect(shell.close.box.height).toBeGreaterThanOrEqual(44);
  expect(shell.body.overflowY).toBe('auto');
  expect(shell.body.overscrollBehaviorY).toBe('contain');
}

function assertSharedShell(md: ModalShell, lg: ModalShell): void {
  expect(md.overlay.padding).toEqual(lg.overlay.padding);
  expect(md.header.padding).toEqual(lg.header.padding);
  expect(md.header.borderBottomWidth).toBe(lg.header.borderBottomWidth);
  expect(md.title).toEqual(lg.title);
  expect(md.body.padding).toEqual(lg.body.padding);
  expect(md.body.overflowY).toBe(lg.body.overflowY);
  expect(md.body.overscrollBehaviorY).toBe(lg.body.overscrollBehaviorY);
  expect(md.dialog.borderRadius).toBe(lg.dialog.borderRadius);
  expect(md.dialog.maxHeight).toBe(lg.dialog.maxHeight);
  expect(md.close.box.width).toBe(lg.close.box.width);
  expect(md.close.box.height).toBe(lg.close.box.height);
  expect(md.close.borderRadius).toBe(lg.close.borderRadius);
}

async function assertKeyboardTrapAndClose(
  page: Page,
  dialog: Locator,
  trigger: Locator
): Promise<void> {
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const close = dialog.locator('.modal__close');
  await expect(close).toBeFocused();

  const lastFocusable = dialog
    .locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    .last();
  await lastFocusable.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastFocusable).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

test('los diálogos `md` y `lg` comparten shell, accesibilidad y geometría responsive', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/calendar', 'Modal shell geometry');
  const calendarTrigger = page
    .locator('.cal-top__right')
    .getByRole('button', { name: /Objetivo/ })
    .first();
  await expect(calendarTrigger).toBeVisible();
  await calendarTrigger.focus();
  await page.keyboard.press('Enter');

  const calendarDialog = page.getByRole('dialog', { name: 'Objetivos Nutricionales' });
  await expect(calendarDialog).toBeVisible();
  await expect(calendarDialog).toHaveAccessibleName('Objetivos Nutricionales');
  await waitForModalAnimation(calendarDialog);

  const calendarMeasurements: ModalShell[] = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForLayout(page);
    const shell = await inspectModal(calendarDialog);
    assertModalFits(shell, '500px');
    calendarMeasurements.push(shell);
  }
  await assertKeyboardTrapAndClose(page, calendarDialog, calendarTrigger);

  await page.goto('/ai-config');
  await expect(page.locator('h1.ai-config__title')).toBeVisible();
  const aiConfigTrigger = page.getByRole('button', { name: /Agregar configuración/ }).first();
  await expect(aiConfigTrigger).toBeVisible();
  await aiConfigTrigger.focus();
  await page.keyboard.press('Enter');

  const aiConfigDialog = page.getByRole('dialog', { name: 'Nueva Configuración' });
  await expect(aiConfigDialog).toBeVisible();
  await waitForModalAnimation(aiConfigDialog);

  const aiConfigMeasurements: ModalShell[] = [];
  for (const [index, viewport] of VIEWPORTS.entries()) {
    await page.setViewportSize(viewport);
    await waitForLayout(page);
    const shell = await inspectModal(aiConfigDialog);
    assertModalFits(shell, '700px');
    assertSharedShell(calendarMeasurements[index], shell);
    aiConfigMeasurements.push(shell);

    if (viewport.height === 320) {
      expect(shell.body.scrollHeight).toBeGreaterThan(shell.body.clientHeight);
      await aiConfigDialog.locator('.modal__body').evaluate((body) => {
        body.scrollTop = body.scrollHeight;
      });
      await expect(aiConfigDialog.getByRole('button', { name: 'Crear' })).toBeInViewport();
    }
  }
  await assertKeyboardTrapAndClose(page, aiConfigDialog, aiConfigTrigger);

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    const mobile = testInfo.project.name === 'mobile-chrome';
    const viewport = mobile ? { width: 393, height: 851 } : { width: 1440, height: 900 };

    await aiConfigTrigger.click();
    await expect(aiConfigDialog).toBeVisible();
    await waitForModalAnimation(aiConfigDialog);
    await page.setViewportSize(viewport);
    await waitForLayout(page);
    await page.screenshot({
      path: join(screenshotDirectory, `ai-config-modal-${testInfo.project.name}.png`),
      animations: 'disabled'
    });

    await aiConfigDialog.locator('.modal__close').click();
    await expect(aiConfigDialog).toHaveCount(0);
    await page.goto('/calendar');
    const objectivesTrigger = page
      .locator('.cal-top__right')
      .getByRole('button', { name: /Objetivo/ })
      .first();
    await expect(objectivesTrigger).toBeVisible();
    await objectivesTrigger.click();
    await expect(calendarDialog).toBeVisible();
    await waitForModalAnimation(calendarDialog);
    await page.setViewportSize(viewport);
    await waitForLayout(page);
    await page.screenshot({
      path: join(screenshotDirectory, `calendar-objectives-modal-${testInfo.project.name}.png`),
      animations: 'disabled'
    });
  }

  expect(calendarMeasurements).toHaveLength(VIEWPORTS.length);
  expect(aiConfigMeasurements).toHaveLength(VIEWPORTS.length);
});
