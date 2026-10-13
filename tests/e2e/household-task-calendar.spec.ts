import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const TASK_DATE = '2026-10-12';
const TASK_TITLE = 'Revisar reciclaje del hogar';

const taskPlan = {
  schemaVersion: 1,
  dwellingType: 'apartment',
  dwellingTypeLabel: null,
  summary: 'Plano E2E sintético',
  warnings: [],
  floors: [
    {
      id: 'floor-e2e',
      name: 'Planta baja',
      level: 0,
      walls: [],
      openings: [],
      spaces: [
        {
          id: 'kitchen-e2e',
          kind: 'kitchen',
          label: 'Cocina',
          polygon: [
            { x: 100, y: 100 },
            { x: 900, y: 100 },
            { x: 900, y: 900 },
            { x: 100, y: 900 }
          ],
          parentSpaceId: null
        }
      ]
    }
  ]
};

async function seedHouseholdTask(page: Page): Promise<string> {
  return page.evaluate(
    async ({ plan, date, title }) => {
      const token = localStorage.getItem('hogar:v1:auth_token');
      if (!token) throw new Error('Synthetic browser session has no auth token.');
      const authorization = `Bearer ${token}`;
      const householdResponse = await fetch('/api/household', {
        headers: { authorization }
      });
      if (!householdResponse.ok) throw new Error('Could not load the synthetic household.');
      const householdEnvelope = await householdResponse.json();
      const household = householdEnvelope?.data;
      if (!household?.id) throw new Error('The synthetic household is not active.');

      const headers = {
        authorization,
        'content-type': 'application/json',
        'x-household-id': household.id
      };
      const planRead = await fetch('/api/household/plan', { headers });
      if (!planRead.ok) throw new Error('Could not read the synthetic household plan.');
      const snapshot = (await planRead.json())?.data;
      const planWrite = await fetch('/api/household/plan', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ baseVersion: snapshot.version, plan })
      });
      if (!planWrite.ok) throw new Error(`Could not seed synthetic plan (${planWrite.status}).`);

      const member = household.members?.find((entry: { isActive: boolean }) => entry.isActive);
      if (!member?.userId || !member?.name) throw new Error('No active synthetic member found.');
      const taskWrite = await fetch('/api/household/tasks?weekStart=2026-10-12', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          baseVersion: 0,
          weekStart: '2026-10-12',
          tasks: [
            {
              id: 'calendar-task-e2e',
              title,
              details: 'Tarea de prueba aislada',
              spaceId: 'kitchen-e2e',
              scheduledDate: date,
              assignedMemberId: member.userId,
              completed: true
            }
          ]
        })
      });
      if (!taskWrite.ok) throw new Error(`Could not seed synthetic task (${taskWrite.status}).`);
      return member.name;
    },
    { plan: taskPlan, date: TASK_DATE, title: TASK_TITLE }
  );
}

async function capture(page: Page, name: string): Promise<void> {
  const root = process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), '.e2e-screenshots');
  const path = join(root, 'household-task-calendar', test.info().project.name, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.mouse.move(-20, -20);
  await page.screenshot({ path, fullPage: false, scale: 'css', animations: 'disabled' });
}

test('el calendario actual muestra tareas del hogar, zona, estado y persona asignada', async ({
  page
}) => {
  await registerWithHousehold(
    page,
    '/calendar?view=agenda&date=2026-10-12',
    `Calendar Reader ${randomUUID().slice(0, 6)}`
  );
  const memberName = await seedHouseholdTask(page);

  const rangeRequest = page.waitForResponse(
    (response) =>
      response.url().includes('/api/calendar/range') &&
      new URL(response.url()).searchParams.get('startDate') === TASK_DATE
  );
  await page.goto('/calendar?view=agenda&date=2026-10-12');
  const response = await rangeRequest;
  expect(response.status()).toBe(200);
  const envelope = await response.json();
  expect(envelope.data.tasks).toEqual([
    expect.objectContaining({
      title: TASK_TITLE,
      date: TASK_DATE,
      zoneName: 'Cocina',
      assignedMemberName: memberName,
      completed: true
    })
  ]);
  expect(envelope.data.tasks[0]).not.toHaveProperty('details');

  const task = page.locator('[data-test="calendar-household-task"]');
  await expect(task).toBeVisible();
  await expect(task).toContainText(TASK_TITLE);
  await expect(task).toContainText('Cocina');
  await expect(task).toContainText(`Asignada a ${memberName}`);
  await expect(task).toContainText('Completada');

  const taskLayer = page.locator('[data-test="layer-tasks"]');
  await expect(taskLayer).toBeVisible();
  await expect(taskLayer).toHaveAttribute('aria-pressed', 'true');
  await task.scrollIntoViewIfNeeded();
  await capture(page, 'household-task-in-agenda');
  await taskLayer.click();
  await expect(task).toHaveCount(0);
  await taskLayer.click();
  await expect(task).toBeVisible();

  for (const view of ['month', 'week']) {
    await page.goto(`/calendar?view=${view}&date=${TASK_DATE}`);
    const projectedTask = page.locator('[data-test="calendar-household-task"]');
    await expect(projectedTask).toBeVisible();
    await expect(projectedTask).toContainText(TASK_TITLE);
  }

  await page.goto(`/calendar?view=year&date=${TASK_DATE}`);
  await expect(page.locator('.year-month__day.has-items').first()).toBeVisible();
});
