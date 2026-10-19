import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 767, height: 1024 },
  { width: 768, height: 1024 },
  { width: 769, height: 1024 },
  { width: 1023, height: 768 },
  { width: 1024, height: 768 },
  { width: 1025, height: 768 },
  { width: 1440, height: 900 }
];

const CONTROL_KEYS = [
  'height',
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInlineStart',
  'paddingInlineEnd',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInlineStart',
  'marginInlineEnd',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'borderStyle',
  'borderWidth',
  'borderRadius'
] as const;

const LABEL_KEYS = [
  'marginBlockStart',
  'marginBlockEnd',
  'marginInlineStart',
  'marginInlineEnd',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight'
] as const;

type CssValue = number | string;
type Geometry = {
  control: Record<(typeof CONTROL_KEYS)[number], CssValue>;
  label: Record<(typeof LABEL_KEYS)[number], CssValue>;
  labelControlGap: number;
  groupGap: CssValue;
  width: number;
  availableWidth: number;
};

async function geometry(
  page: Page,
  selectors: { control: string; label: string; group: string }
): Promise<Geometry> {
  return page.evaluate(({ control, label, group }) => {
    const controlElement = document.querySelector<HTMLInputElement>(control);
    const labelElement = document.querySelector<HTMLLabelElement>(label);
    const groupElement = document.querySelector<HTMLElement>(group);
    if (!controlElement || !labelElement || !groupElement) {
      throw new Error(`Falta control/label/group: ${control}, ${label}, ${group}`);
    }

    const controlStyle = getComputedStyle(controlElement);
    const labelStyle = getComputedStyle(labelElement);
    const groupStyle = getComputedStyle(groupElement);
    const controlRect = controlElement.getBoundingClientRect();
    const labelRect = labelElement.getBoundingClientRect();
    const availableWidth =
      groupElement.clientWidth -
      Number.parseFloat(groupStyle.paddingLeft) -
      Number.parseFloat(groupStyle.paddingRight);
    const px = (value: string): number => Number.parseFloat(value) || 0;

    return {
      control: {
        height: Number(controlRect.height.toFixed(2)),
        paddingBlockStart: px(controlStyle.paddingBlockStart),
        paddingBlockEnd: px(controlStyle.paddingBlockEnd),
        paddingInlineStart: px(controlStyle.paddingInlineStart),
        paddingInlineEnd: px(controlStyle.paddingInlineEnd),
        marginBlockStart: px(controlStyle.marginBlockStart),
        marginBlockEnd: px(controlStyle.marginBlockEnd),
        marginInlineStart: px(controlStyle.marginInlineStart),
        marginInlineEnd: px(controlStyle.marginInlineEnd),
        fontFamily: controlStyle.fontFamily,
        fontSize: controlStyle.fontSize,
        fontWeight: controlStyle.fontWeight,
        lineHeight: controlStyle.lineHeight,
        borderStyle: controlStyle.borderTopStyle,
        borderWidth: px(controlStyle.borderTopWidth),
        borderRadius: px(controlStyle.borderTopLeftRadius)
      },
      label: {
        marginBlockStart: px(labelStyle.marginBlockStart),
        marginBlockEnd: px(labelStyle.marginBlockEnd),
        marginInlineStart: px(labelStyle.marginInlineStart),
        marginInlineEnd: px(labelStyle.marginInlineEnd),
        fontFamily: labelStyle.fontFamily,
        fontSize: labelStyle.fontSize,
        fontWeight: labelStyle.fontWeight,
        lineHeight: labelStyle.lineHeight
      },
      labelControlGap: Number((controlRect.top - labelRect.bottom).toFixed(2)),
      groupGap: groupStyle.rowGap,
      width: Number(controlRect.width.toFixed(2)),
      availableWidth: Number(availableWidth.toFixed(2))
    };
  }, selectors);
}

function geometryDifferences(reference: Geometry, actual: Geometry, context: string): string[] {
  const differences: string[] = [];
  for (const key of CONTROL_KEYS) {
    const expected = reference.control[key];
    const received = actual.control[key];
    if (
      typeof expected === 'number' &&
      typeof received === 'number' &&
      Math.abs(expected - received) <= 1
    ) {
      continue;
    }
    if (expected === received) continue;
    differences.push(`${context} control.${key}: ${received} vs ${expected}`);
  }
  for (const key of LABEL_KEYS) {
    const expected = reference.label[key];
    const received = actual.label[key];
    if (
      typeof expected === 'number' &&
      typeof received === 'number' &&
      Math.abs(expected - received) <= 1
    ) {
      continue;
    }
    if (expected === received) continue;
    differences.push(`${context} label.${key}: ${received} vs ${expected}`);
  }
  if (Math.abs(reference.labelControlGap - actual.labelControlGap) > 1) {
    differences.push(
      `${context} label-control gap: ${actual.labelControlGap} vs ${reference.labelControlGap}`
    );
  }
  if (Math.abs(actual.width - actual.availableWidth) > 1) {
    differences.push(
      `${context} input does not fill its field: ${actual.width}px vs ${actual.availableWidth}px`
    );
  }
  return differences;
}

function contractDifferences(actual: Geometry, context: string): string[] {
  const expectedControl: Geometry['control'] = {
    height: 42,
    paddingBlockStart: 8,
    paddingBlockEnd: 8,
    paddingInlineStart: 12,
    paddingInlineEnd: 12,
    marginBlockStart: 0,
    marginBlockEnd: 0,
    marginInlineStart: 0,
    marginInlineEnd: 0,
    fontFamily: actual.control.fontFamily,
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12
  };
  const expectedLabel: Geometry['label'] = {
    marginBlockStart: 0,
    marginBlockEnd: 0,
    marginInlineStart: 0,
    marginInlineEnd: 0,
    fontFamily: actual.control.fontFamily,
    fontSize: '14px',
    fontWeight: '500',
    lineHeight: '21px'
  };
  const differences: string[] = [];
  for (const key of CONTROL_KEYS) {
    const expected = expectedControl[key];
    const received = actual.control[key];
    if (
      typeof expected === 'number' &&
      typeof received === 'number' &&
      Math.abs(expected - received) <= 1
    ) {
      continue;
    }
    if (expected !== received)
      differences.push(`${context} contract control.${key}: ${received} vs ${expected}`);
  }
  for (const key of LABEL_KEYS) {
    const expected = expectedLabel[key];
    const received = actual.label[key];
    if (
      typeof expected === 'number' &&
      typeof received === 'number' &&
      Math.abs(expected - received) <= 1
    ) {
      continue;
    }
    if (expected !== received)
      differences.push(`${context} contract label.${key}: ${received} vs ${expected}`);
  }
  if (actual.groupGap !== '4px') {
    differences.push(`${context} contract group gap: ${actual.groupGap} vs 4px`);
  }
  if (Math.abs(actual.labelControlGap - 4) > 1) {
    differences.push(`${context} contract label-control gap: ${actual.labelControlGap} vs 4px`);
  }
  if (Math.abs(actual.width - actual.availableWidth) > 1) {
    differences.push(
      `${context} control does not fill its field: ${actual.width}px vs ${actual.availableWidth}px`
    );
  }
  return differences;
}

async function noHorizontalOverflow(page: Page, viewport: { width: number; height: number }) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `sin overflow a ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(
    viewport.width
  );
}

async function waitForModalAnimations(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').evaluate(async (dialog) => {
    const animations = dialog.getAnimations({ subtree: true });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

test('los campos de texto equivalentes comparten geometría entre vistas', async ({
  page
}, testInfo) => {
  const mismatches: string[] = [];

  await page.goto('/auth/login');
  const email = page.locator('#email');
  await expect(email).toBeVisible();
  await expect(email).toHaveAccessibleName(/.+/);
  await page.evaluate(() => document.fonts.ready);

  const loginGeometry = new Map<string, Geometry>();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const measured = await geometry(page, {
      control: '#email',
      label: 'label[for="email"]',
      group: 'app-input:has(#email) .input-group'
    });
    loginGeometry.set(`${viewport.width}x${viewport.height}`, measured);
    mismatches.push(...contractDifferences(measured, `login ${viewport.width}×${viewport.height}`));
    await noHorizontalOverflow(page, viewport);
    if (viewport.width === 393 || viewport.width === 1440) {
      const directory = process.env.E2E_SCREENSHOT_DIR;
      if (directory) {
        mkdirSync(directory, { recursive: true });
        await page.screenshot({
          path: join(
            directory,
            `${testInfo.project.name}-login-${viewport.width}x${viewport.height}.png`
          ),
          fullPage: false
        });
      }
    }
  }

  const loginField = loginGeometry.get('320x568');
  if (!loginField) throw new Error('Falta la medición de login a 320×568.');
  await email.focus();
  await expect(email).toBeFocused();
  const focusedLogin = await geometry(page, {
    control: '#email',
    label: 'label[for="email"]',
    group: 'app-input:has(#email) .input-group'
  });
  mismatches.push(...geometryDifferences(loginField, focusedLogin, 'login/focus'));
  mismatches.push(...contractDifferences(focusedLogin, 'login/focus'));
  await page.keyboard.press('Tab');
  await expect(page.locator('#password')).toBeFocused();

  const loginPosts: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/login' && request.method() === 'POST') {
      loginPosts.push(request.url());
    }
  });
  await email.fill('');
  await page
    .locator('form.login-form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(loginPosts).toEqual([]);
  const invalidLogin = await geometry(page, {
    control: '#email',
    label: 'label[for="email"]',
    group: 'app-input:has(#email) .input-group'
  });
  mismatches.push(...geometryDifferences(loginField, invalidLogin, 'login/error'));
  mismatches.push(...contractDifferences(invalidLogin, 'login/error'));

  await registerAndGoto(page, '/account', 'Text field geometry');
  if (testInfo.project.name === 'mobile-chrome') {
    await expect(page.locator('.header__menu')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
  }
  const accountName = page.locator('#account-name');
  await expect(accountName).toBeVisible();
  await expect(accountName).toHaveAccessibleName(/.+/);
  const accountGeometry = new Map<string, Geometry>();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    if (testInfo.project.name === 'mobile-chrome' && viewport.width < 1024) {
      const sidebar = page.locator('#primary-sidebar');
      await expect
        .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right))
        .toBeLessThanOrEqual(1);
      await expect(page.locator('.header__menu')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
      await accountName.scrollIntoViewIfNeeded();
      const accountFieldHit = await accountName.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return {
          reachable: hit === element || element.contains(hit),
          input: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scrollY: window.scrollY,
          hit: hit ? { tag: hit.tagName, id: hit.id, className: String(hit.className) } : null
        };
      });
      expect(
        accountFieldHit.reachable,
        `el input debe recibir el hit-test: ${JSON.stringify(accountFieldHit)}`
      ).toBe(true);
    }
    const measured = await geometry(page, {
      control: '#account-name',
      label: 'label[for="account-name"]',
      group: '.account__field:has(#account-name)'
    });
    accountGeometry.set(`${viewport.width}x${viewport.height}`, measured);
    mismatches.push(
      ...contractDifferences(measured, `account ${viewport.width}×${viewport.height}`)
    );
    mismatches.push(
      ...geometryDifferences(
        loginGeometry.get(`${viewport.width}x${viewport.height}`)!,
        measured,
        `account ${viewport.width}×${viewport.height}`
      )
    );
    await noHorizontalOverflow(page, viewport);
    if (viewport.width === 393 || viewport.width === 1440) {
      const directory = process.env.E2E_SCREENSHOT_DIR;
      if (directory) {
        await page.screenshot({
          path: join(
            directory,
            `${testInfo.project.name}-account-${viewport.width}x${viewport.height}.png`
          ),
          fullPage: false
        });
      }
    }
  }

  const accountDefault = accountGeometry.get('320x568');
  if (!accountDefault) throw new Error('Falta la medición de Cuenta a 320×568.');
  await accountName.focus();
  await expect(accountName).toBeFocused();
  const focusedAccount = await geometry(page, {
    control: '#account-name',
    label: 'label[for="account-name"]',
    group: '.account__field:has(#account-name)'
  });
  mismatches.push(...geometryDifferences(accountDefault, focusedAccount, 'account/focus'));
  mismatches.push(...contractDifferences(focusedAccount, 'account/focus'));

  await accountName.fill('A');
  await page.locator('[data-test="account-name-save"]').click();
  await expect(page.locator('[data-test="account-name-error"]')).toBeVisible();
  const invalidAccount = await geometry(page, {
    control: '#account-name',
    label: 'label[for="account-name"]',
    group: '.account__field:has(#account-name)'
  });
  mismatches.push(...geometryDifferences(accountDefault, invalidAccount, 'account/error'));
  mismatches.push(...contractDifferences(invalidAccount, 'account/error'));

  await page.goto('/calendar');
  await page.locator('[data-test="event-add"]').click();
  await waitForModalAnimations(page);
  const eventTitle = page.locator('#event-title');
  await expect(eventTitle).toBeVisible();
  await expect(eventTitle).toHaveAccessibleName(/.+/);
  const calendarGeometry = new Map<string, Geometry>();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    if (testInfo.project.name === 'mobile-chrome' && viewport.width < 1024) {
      await expect(page.locator('.header__menu')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
      await expect
        .poll(() =>
          page
            .locator('#primary-sidebar')
            .evaluate((sidebar) => sidebar.getBoundingClientRect().right)
        )
        .toBeLessThanOrEqual(1);
    }
    const measured = await geometry(page, {
      control: '#event-title',
      label: 'label[for="event-title"]',
      group: '.meal-form__field:has(#event-title)'
    });
    calendarGeometry.set(`${viewport.width}x${viewport.height}`, measured);
    mismatches.push(
      ...contractDifferences(measured, `calendar ${viewport.width}×${viewport.height}`)
    );
    mismatches.push(
      ...geometryDifferences(
        loginGeometry.get(`${viewport.width}x${viewport.height}`)!,
        measured,
        `calendar ${viewport.width}×${viewport.height}`
      )
    );
    await noHorizontalOverflow(page, viewport);
    if (viewport.width === 393 || viewport.width === 1440) {
      const directory = process.env.E2E_SCREENSHOT_DIR;
      if (directory) {
        await page.screenshot({
          path: join(
            directory,
            `${testInfo.project.name}-calendar-${viewport.width}x${viewport.height}.png`
          ),
          fullPage: false
        });
      }
    }
  }

  const eventDefault = calendarGeometry.get('320x568');
  if (!eventDefault) throw new Error('Falta la medición de Calendario a 320×568.');
  await eventTitle.focus();
  await expect(eventTitle).toBeFocused();
  const focusedEventTitle = await geometry(page, {
    control: '#event-title',
    label: 'label[for="event-title"]',
    group: '.meal-form__field:has(#event-title)'
  });
  mismatches.push(...geometryDifferences(eventDefault, focusedEventTitle, 'calendar/focus'));
  mismatches.push(...contractDifferences(focusedEventTitle, 'calendar/focus'));
  await expect(page.locator('[data-test="event-save"]')).toBeDisabled();

  expect(mismatches, 'los campos equivalentes deben mantener geometría común').toEqual([]);
  expect(loginPosts).toEqual([]);
});
