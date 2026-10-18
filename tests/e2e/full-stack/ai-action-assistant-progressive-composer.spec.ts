import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';

const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/assistant-compose-progressive-20261018';

async function captureComposer(page: Page, projectName: string, width: number): Promise<void> {
  const directory = join(resolve(SCREENSHOT_DIR), projectName);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, 'assistant-compose-' + width + 'px.png'),
    animations: 'disabled'
  });
}

test('asistente global: compositor progresivo junto al dictado', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let proposalRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.name + ': ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ai/assistant/proposals')) {
      proposalRequests += 1;
    }
  });

  await registerUser(page, 'Asistente compositor progresivo');
  await createHousehold(page, 'Hogar compositor progresivo');
  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.getByRole('dialog', { name: 'Asistente' });
  const compose = dialog.locator('[data-test="ai-assistant-compose"]');
  const prompt = compose.locator('[data-test="ai-assistant-prompt"]');
  const tools = compose.locator('.assistant__field-tools');
  const warning = compose.locator('.assistant__voice-warning');
  const privacy = compose.locator('details.assistant__privacy');
  const privacySummary = privacy.locator('summary');
  const micButton = compose.locator('[data-test="ai-assistant-voice-start"] button');

  await expect(dialog).toBeVisible();
  await expect(prompt).toHaveAccessibleName('Tu petición');
  await expect(prompt).toHaveAttribute(
    'placeholder',
    'Pídele a la IA qué hacer.\nEj.: añade leche o crea una tarea.'
  );
  await expect(compose.locator('#ai-assistant-prompt-help')).toHaveCount(0);
  await expect(compose.getByRole('heading')).toHaveCount(0);
  await expect(compose.locator('.assistant__counter')).toHaveCount(0);
  await expect(privacy).toHaveJSProperty('open', false);
  await expect(privacySummary).toHaveText('Ver más');
  await expect(warning).toHaveText('El audio puede salir del dispositivo.');
  await expect(compose.locator('.assistant__consent')).toHaveCount(0);
  await expect(compose.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(micButton).toHaveAccessibleName('Dictar petición');
  await expect(micButton).toBeEnabled();
  await expect
    .poll(() =>
      prompt.evaluate((element) => {
        return Math.abs(
          element.getBoundingClientRect().height -
            Number.parseFloat(getComputedStyle(element).minHeight)
        );
      })
    )
    .toBeLessThanOrEqual(1);

  const viewports = [
    { width: 1440, height: 900 },
    { width: 851, height: 393 },
    { width: 641, height: 800 },
    { width: 640, height: 800 },
    { width: 393, height: 851 },
    { width: 320, height: 568 }
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    await expect(micButton).toBeEnabled();
    if (
      (viewport.width === 1440 && testInfo.project.name === 'chromium') ||
      ((viewport.width === 393 || viewport.width === 320) &&
        testInfo.project.name === 'mobile-chrome')
    ) {
      await captureComposer(page, testInfo.project.name, viewport.width);
    }

    const geometry = await page.evaluate(() => {
      const promptElement = document.querySelector<HTMLElement>(
        '[data-test="ai-assistant-prompt"]'
      );
      const toolsElement = document.querySelector<HTMLElement>('.assistant__field-tools');
      const warningElement = document.querySelector<HTMLElement>('.assistant__voice-warning');
      const privacyElement = document.querySelector<HTMLElement>('.assistant__privacy');
      const micElement = document.querySelector<HTMLElement>(
        '[data-test="ai-assistant-voice-start"] button'
      );
      if (!promptElement || !toolsElement || !warningElement || !privacyElement || !micElement) {
        throw new Error('Falta un control del compositor.');
      }
      const promptRect = promptElement.getBoundingClientRect();
      const toolsRect = toolsElement.getBoundingClientRect();
      const warningRect = warningElement.getBoundingClientRect();
      const privacyRect = privacyElement.getBoundingClientRect();
      const micRect = micElement.getBoundingClientRect();
      const style = getComputedStyle(promptElement);
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        promptHeight: promptRect.height,
        toolsInsidePrompt:
          toolsRect.left >= promptRect.left &&
          toolsRect.right <= promptRect.right &&
          toolsRect.bottom <= promptRect.bottom + 1,
        warningToPrivacyGap: privacyRect.left - warningRect.right,
        privacyToMicGap: micRect.left - privacyRect.right,
        warningMicCenterDelta:
          warningRect.top + warningRect.height / 2 - (micRect.top + micRect.height / 2),
        micWidth: micRect.width,
        micHeight: micRect.height,
        promptRect: {
          left: promptRect.left,
          right: promptRect.right,
          bottom: promptRect.bottom
        },
        toolsRect: {
          left: toolsRect.left,
          right: toolsRect.right,
          bottom: toolsRect.bottom
        },
        promptMaximum: Number.parseFloat(style.maxHeight)
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.promptHeight).toBeLessThan(132);
    expect(geometry.toolsInsidePrompt, JSON.stringify(geometry)).toBe(true);
    expect(geometry.warningToPrivacyGap).toBeGreaterThanOrEqual(0);
    expect(geometry.warningToPrivacyGap).toBeLessThanOrEqual(8);
    expect(geometry.privacyToMicGap).toBeGreaterThanOrEqual(0);
    expect(geometry.privacyToMicGap).toBeLessThanOrEqual(8);
    expect(Math.abs(geometry.warningMicCenterDelta)).toBeLessThanOrEqual(2);
    await expect
      .poll(() => micButton.boundingBox().then((bounds) => bounds?.width ?? 0))
      .toBeGreaterThanOrEqual(44);
    await expect
      .poll(() => micButton.boundingBox().then((bounds) => bounds?.height ?? 0))
      .toBeGreaterThanOrEqual(44);

    await privacySummary.focus();
    await page.keyboard.press('Enter');
    await expect(compose.locator('.assistant__voice-note')).toBeVisible();
    const disclosureBounds = await compose.locator('.assistant__voice-note').boundingBox();
    const dialogBounds = await dialog.boundingBox();
    expect(disclosureBounds).not.toBeNull();
    expect(dialogBounds).not.toBeNull();
    expect(disclosureBounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x);
    expect(disclosureBounds!.x + disclosureBounds!.width).toBeLessThanOrEqual(
      dialogBounds!.x + dialogBounds!.width
    );
    await page.keyboard.press('Enter');
    await expect(compose.locator('.assistant__voice-note')).toBeHidden();

    const initialHeight = geometry.promptHeight;
    await prompt.fill('Añade lentejas a la despensa. '.repeat(10));
    const shortHeight = (await prompt.boundingBox())?.height ?? 0;
    expect(shortHeight).toBeGreaterThan(initialHeight);

    await prompt.fill('Añade lentejas a la despensa. '.repeat(60));
    const maxGeometry = await prompt.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        maxHeight: Number.parseFloat(style.maxHeight),
        overflowY: style.overflowY,
        hasHiddenOverflow: element.scrollHeight > element.clientHeight
      };
    });
    expect(maxGeometry.height).toBeLessThanOrEqual(maxGeometry.maxHeight + 1);
    expect(maxGeometry.overflowY).toBe('auto');
    expect(maxGeometry.hasHiddenOverflow).toBe(true);

    await prompt.fill('');
    await expect
      .poll(() => prompt.boundingBox().then((bounds) => bounds?.height ?? Infinity))
      .toBeLessThanOrEqual(132);
  }

  expect(proposalRequests).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
