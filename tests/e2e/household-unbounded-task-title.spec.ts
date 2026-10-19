import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

test('task title over 120 characters is editable and persists unchanged', async ({
  page
}, info) => {
  await registerWithHousehold(page, '/household?tab=tasks', 'Texto largo E2E');
  await expect(page.locator('[data-test="household-planning-panel-tasks"]')).toBeVisible();

  const title = 'Limpiar cocina. '.repeat(179) + 'Limpiar cocina.';
  const titleInput = page.getByRole('textbox', { name: 'Nombre de la tarea' });
  await expect(titleInput).toBeVisible();
  await expect(titleInput).not.toHaveAttribute('maxlength');

  const screenshotDir = join(process.cwd(), '.e2e-screenshots', 'ai-unbounded-text');
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, `tasks-${info.project.name}.png`) });

  await titleInput.fill(title);
  await page.locator('[data-test="tasks-add"]').click();
  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.locator('[data-test="tasks-save"]').click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);
  const envelope = await saveResponse.json();
  expect(envelope.data.tasks).toHaveLength(1);
  expect(envelope.data.tasks[0].title).toBe(title);

  await page.reload();
  await expect(page.locator('[data-test="household-planning-panel-tasks"]')).toBeVisible();
  await page.locator('.task-card__details summary').click();
  const savedTitleInput = page.locator('.task-card__title--details input');
  await expect(savedTitleInput).toHaveValue(title);
  await expect(savedTitleInput).not.toHaveAttribute('maxlength');
  await expect(page.locator('html')).toHaveJSProperty(
    'scrollWidth',
    await page.evaluate(() => innerWidth)
  );
});
