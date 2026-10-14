import { access, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

interface AutomationSnapshot {
  enabled: boolean;
  mode: 'generate' | 'repeat' | null;
  scopes: Array<'tasks' | 'meals'>;
  weekday: number | null;
  localTime: string | null;
  timeZone: string | null;
  version: number;
  nextRunAt: string | null;
  nextRun: {
    localDate: string;
    localTime: string;
    timeZone: string;
    utcInstant: string;
  } | null;
  lastRun: {
    targetWeekStart: string;
    status: string;
    failureCode: string | null;
  } | null;
}

interface SyntheticChatCompletionRequest {
  messages?: Array<{ role?: string; content?: unknown }>;
  response_format?: {
    type?: string;
    json_schema?: { name?: string; strict?: boolean };
  };
}

const screenshotsDirectory = resolve('.e2e-screenshots/household-planning-automation');
const weekdayLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function madridScheduleDay(offsetDays: number): { weekday: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((values, part) => {
      if (part.type !== 'literal') values[part.type] = part.value;
      return values;
    }, {});
  const target = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays)
  );
  const day = target.getUTCDay();
  return {
    weekday: day === 0 ? 7 : day,
    date: target.toISOString().slice(0, 10)
  };
}

function dueMadridSchedule(): { weekday: number; date: string; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
    .formatToParts(new Date(Date.now() + 4 * 24 * 60 * 60 * 1_000))
    .reduce<Record<string, string>>((values, part) => {
      if (part.type !== 'literal') values[part.type] = part.value;
      return values;
    }, {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return {
    weekday: day === 0 ? 7 : day,
    date,
    localTime: `${parts.hour}:${parts.minute}`
  };
}

async function readAutomation(
  page: Parameters<typeof registerWithHousehold>[0],
  householdId: string,
  token: string
): Promise<AutomationSnapshot> {
  const response = await page.request.get('/api/household/planning-automation', {
    headers: {
      authorization: `Bearer ${token}`,
      'x-household-id': householdId
    }
  });
  const responseText = await response.text();
  expect(response.status(), responseText).toBe(200);
  const body = JSON.parse(responseText) as { data: AutomationSnapshot };
  return body.data;
}

async function readSchedulerPollCount(): Promise<number> {
  const runDir = process.env.E2E_RUN_DIR;
  if (!runDir) return 0;
  try {
    const contents = await readFile(join(runDir, 'planning-automation-polls.log'), 'utf8');
    return contents.split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function pauseAutomationForCleanup(
  page: Parameters<typeof registerWithHousehold>[0],
  householdId: string,
  token: string
): Promise<void> {
  const headers = { authorization: `Bearer ${token}`, 'x-household-id': householdId };
  const snapshot = await readAutomation(page, householdId, token);
  if (snapshot.enabled) {
    const response = await page.request.patch('/api/household/planning-automation', {
      headers,
      data: { expectedVersion: snapshot.version, enabled: false }
    });
    const responseText = await response.text();
    expect(response.status(), responseText).toBe(200);
  }

  await expect
    .poll(async () => (await readAutomation(page, householdId, token)).enabled)
    .toBe(false);
  await expect
    .poll(async () => (await readAutomation(page, householdId, token)).lastRun?.status, {
      timeout: 30_000,
      intervals: [100, 250, 500, 1_000]
    })
    .not.toBe('in_progress');
}

async function expectNoHorizontalOverflow(
  page: Parameters<typeof registerWithHousehold>[0],
  viewportWidth: number
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    )
    .toBeLessThanOrEqual(viewportWidth);
}

async function captureWithoutOverwrite(
  page: Parameters<typeof registerWithHousehold>[0],
  project: string,
  width: number,
  height: number
): Promise<string> {
  await mkdir(screenshotsDirectory, { recursive: true });
  const path = resolve(screenshotsDirectory, `${project}-${width}x${height}-${randomUUID()}.png`);
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing E2E screenshot: ${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to overwrite')) throw error;
  }
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  console.info(`[household-planning-automation] screenshot: ${path}`);
  return path;
}

test('configura la planificación automática con API real y controles accesibles', async ({
  page
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chrome';
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await registerWithHousehold(
    page,
    '/household?tab=tasks&planning=settings',
    'Automatización sintética'
  );

  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();
  const householdResponse = await page.request.get('/api/household', {
    headers: { authorization: `Bearer ${token}` }
  });
  const householdText = await householdResponse.text();
  expect(householdResponse.status(), householdText).toBe(200);
  const householdBody = JSON.parse(householdText) as { data: { id: string } };
  const householdId = householdBody.data.id;
  const initial = await readAutomation(page, householdId, token!);
  expect(initial).toMatchObject({
    enabled: false,
    mode: null,
    scopes: [],
    weekday: null,
    localTime: null,
    timeZone: null,
    nextRun: null
  });

  const panel = page.locator('[data-test="planning-automation-settings"]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-test="household-planning-tab-settings"]')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.locator('[data-test="household-planning-panel-settings"]')).toBeVisible();

  const patchBodies: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      request.url().includes('/api/household/planning-automation')
    ) {
      patchBodies.push(request.postData() ?? '');
    }
  });

  const generate = panel.locator('[data-test="planning-automation-mode-generate"]');
  const repeat = panel.locator('[data-test="planning-automation-mode-repeat"]');
  const tasks = panel.locator('[data-test="planning-automation-scope-tasks"]');
  const meals = panel.locator('[data-test="planning-automation-scope-meals"]');
  const save = panel.locator('[data-test="planning-automation-save"] button');

  // Radio and checkbox groups are operable from the keyboard, not only by clicking labels.
  await generate.focus();
  await expect(generate).toBeFocused();
  await generate.press('Space');
  await expect(generate).toBeChecked();
  await generate.press('ArrowRight');
  await expect(repeat).toBeChecked();
  await repeat.press('ArrowLeft');
  await expect(generate).toBeChecked();
  await tasks.focus();
  await tasks.press('Space');
  await expect(tasks).toBeChecked();

  // An incomplete setup must be rejected in the UI without sending a partial PATCH.
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.locator('[data-test="planning-automation-validation"]')).toBeVisible();
  expect(patchBodies).toHaveLength(0);
  expect((await readAutomation(page, householdId, token!)).version).toBe(initial.version);

  const target = madridScheduleDay(4);
  const weekdayPicker = panel.locator('[data-test="planning-automation-weekday"] button');
  await weekdayPicker.focus();
  await expect(weekdayPicker).toBeFocused();
  await page.keyboard.press('ArrowDown'); // Opens the custom picker with Monday active.
  const weekdayList = panel.getByRole('listbox', { name: 'Día de la semana' });
  await expect(weekdayList).toBeVisible();
  await expect(weekdayList.getByRole('option', { name: 'Lunes' })).toHaveClass(
    /picker__option--active/
  );
  for (let index = 0; index < target.weekday - 1; index += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect(weekdayPicker).toHaveAttribute(
    'aria-label',
    `Día de la semana: ${weekdayLabels[target.weekday - 1]}`
  );
  await panel.locator('[data-test="planning-automation-local-time"]').fill('23:50');
  const timeZone = panel.locator('[data-test="planning-automation-time-zone"]');
  await timeZone.fill('Mars/Olympus_Mons');
  await save.click();
  await expect(panel.locator('[data-test="planning-automation-validation"]')).toBeVisible();
  await expect(timeZone).toHaveAttribute('aria-invalid', 'true');
  expect(patchBodies).toHaveLength(0);

  await timeZone.fill('Europe/Madrid');
  const firstSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/api/household/planning-automation')
  );
  await save.click();
  expect((await firstSave).status()).toBe(200);
  await expect(
    panel.getByRole('status').filter({ hasText: 'Configuración guardada' })
  ).toBeVisible();

  let saved = await readAutomation(page, householdId, token!);
  expect(saved).toMatchObject({
    enabled: false,
    mode: 'generate',
    scopes: ['tasks'],
    weekday: target.weekday,
    localTime: '23:50',
    timeZone: 'Europe/Madrid',
    nextRun: null
  });
  expect(JSON.parse(patchBodies[0]!)).toMatchObject({
    mode: 'generate',
    scopes: ['tasks'],
    weekday: target.weekday,
    localTime: '23:50',
    timeZone: 'Europe/Madrid'
  });

  const notice = page.locator('[data-test="planning-automation-notice"]');
  await expect(notice).toBeVisible();
  const resume = page.getByRole('button', { name: 'Reanudar planificación automática' });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect
    .poll(async () => (await readAutomation(page, householdId, token!)).enabled)
    .toBe(true);
  saved = await readAutomation(page, householdId, token!);
  expect(saved.nextRun).toMatchObject({
    localDate: target.date,
    localTime: '23:50',
    timeZone: 'Europe/Madrid'
  });
  expect(saved.mode).toBe('generate');
  expect(Date.parse(saved.nextRun!.utcInstant)).toBeGreaterThan(Date.now() + 48 * 60 * 60 * 1000);
  const formattedNextRun = new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Madrid'
  }).format(new Date(saved.nextRun!.utcInstant));
  await expect(notice).toContainText(formattedNextRun);
  await expect(notice).toContainText('Europe/Madrid');
  await expect(page.getByRole('button', { name: 'Pausar planificación automática' })).toBeVisible();

  // Play/Pause must update the shared config version observed by the settings editor.
  const pause = page.getByRole('button', { name: 'Pausar planificación automática' });
  await pause.click();
  await expect
    .poll(async () => (await readAutomation(page, householdId, token!)).enabled)
    .toBe(false);
  await expect(notice).toContainText('Planificación pausada');
  await expect(
    page.getByRole('button', { name: 'Reanudar planificación automática' })
  ).toBeVisible();
  saved = await readAutomation(page, householdId, token!);
  expect(saved).toMatchObject({ enabled: false, mode: 'generate', nextRun: null });

  const versionAfterPause = saved.version;
  await repeat.check();
  await meals.check();
  const repeatSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/api/household/planning-automation')
  );
  await save.click();
  const repeatResponse = await repeatSave;
  expect(repeatResponse.status(), await repeatResponse.text()).toBe(200);
  await expect(
    panel.getByRole('status').filter({ hasText: 'Configuración guardada' })
  ).toBeVisible();
  const repeatPatch = patchBodies.map((body) => JSON.parse(body)).at(-1);
  expect(repeatPatch).toMatchObject({
    expectedVersion: versionAfterPause,
    mode: 'repeat',
    scopes: ['tasks', 'meals']
  });
  saved = await readAutomation(page, householdId, token!);
  expect(saved).toMatchObject({ enabled: false, mode: 'repeat', scopes: ['tasks', 'meals'] });

  const resumeAgain = page.getByRole('button', { name: 'Reanudar planificación automática' });
  await resumeAgain.click();
  await expect
    .poll(async () => (await readAutomation(page, householdId, token!)).enabled)
    .toBe(true);
  saved = await readAutomation(page, householdId, token!);
  expect(saved.mode).toBe('repeat');
  expect(saved.nextRun?.localDate).toBe(target.date);
  await expect(page.getByRole('button', { name: 'Pausar planificación automática' })).toBeVisible();

  // Pixel bounds and keyboard focus are checked on the target viewport; edge sizes guard breakpoints.
  const saveBounds = await save.boundingBox();
  expect(saveBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(saveBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  for (const selector of [
    '[data-test="planning-automation-local-time"]',
    '[data-test="planning-automation-time-zone"]'
  ]) {
    const bounds = await panel.locator(selector).boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  const noticeBounds = await notice.boundingBox();
  expect(noticeBounds).toBeTruthy();
  expect(noticeBounds!.x).toBeGreaterThanOrEqual(0);
  expect(noticeBounds!.x + noticeBounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(noticeBounds!.y + noticeBounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  await expectNoHorizontalOverflow(page, viewport.width);

  // Confirm the fixed notice does not make the schedule fields or primary action unreachable.
  await save.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  const centeredSave = await save.boundingBox();
  const noticeWhileSaving = await notice.boundingBox();
  expect(centeredSave).toBeTruthy();
  expect(noticeWhileSaving).toBeTruthy();
  expect(
    centeredSave!.y < noticeWhileSaving!.y + noticeWhileSaving!.height &&
      centeredSave!.y + centeredSave!.height > noticeWhileSaving!.y
  ).toBe(false);
  await timeZone.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
  );
  const centeredTimeZone = await timeZone.boundingBox();
  const noticeWhileEditing = await notice.boundingBox();
  expect(centeredTimeZone).toBeTruthy();
  expect(noticeWhileEditing).toBeTruthy();
  expect(
    centeredTimeZone!.y < noticeWhileEditing!.y + noticeWhileEditing!.height &&
      centeredTimeZone!.y + centeredTimeZone!.height > noticeWhileEditing!.y
  ).toBe(false);
  await captureWithoutOverwrite(page, testInfo.project.name, viewport.width, viewport.height);

  if (mobile) {
    for (const size of [
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(size);
      await expectNoHorizontalOverflow(page, size.width);
      const bounds = await notice.boundingBox();
      expect(bounds).toBeTruthy();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
    }
  }

  // The scheduled occurrence is at least four days out, and this E2E never calls generation/retry APIs.
  expect(patchBodies.some((body) => JSON.parse(body).enabled === true)).toBe(true);
  expect(patchBodies.some((body) => JSON.parse(body).enabled === false)).toBe(true);
});

test('publica una propuesta desde el editor pasando por el scheduler y worker reales', async ({
  page
}) => {
  test.skip(
    process.env.HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS !== '4' ||
      process.env.HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS !== '1000',
    'requires the isolated scheduler clock enabled by its dedicated E2E command'
  );
  test.setTimeout(90_000);

  const providerRequests: SyntheticChatCompletionRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const payload = JSON.parse(body) as SyntheticChatCompletionRequest;
      providerRequests.push(payload);
      const userMessage = payload.messages?.find((message) => message.role === 'user')?.content;
      const weekStart =
        typeof userMessage === 'string'
          ? userMessage.match(/"weekStart":"(\d{4}-\d{2}-\d{2})"/)?.[1]
          : undefined;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tasks: weekStart
                    ? [{ title: 'Revisar la cocina', scheduledDate: weekStart, spaceId: null }]
                    : []
                })
              }
            }
          ]
        })
      );
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  let automationContext: { householdId: string; token: string } | null = null;

  try {
    await registerWithHousehold(
      page,
      '/household?tab=tasks&planning=settings',
      'Automatización scheduler sintética'
    );
    const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(token).toBeTruthy();
    const authHeaders = { authorization: `Bearer ${token}` };
    const householdResponse = await page.request.get('/api/household', { headers: authHeaders });
    const householdText = await householdResponse.text();
    expect(householdResponse.status(), householdText).toBe(200);
    const householdBody = JSON.parse(householdText) as {
      data: { id: string; members: Array<{ userId: string; isActive: boolean }> };
    };
    const householdId = householdBody.data.id;
    automationContext = { householdId, token: token! };
    const ownerId = householdBody.data.members.find((member) => member.isActive)?.userId;
    expect(ownerId).toBeTruthy();

    const providerPort = (provider.address() as AddressInfo).port;
    const configResponse = await page.request.post('/api/ai/configs', {
      headers: { ...authHeaders, 'x-household-id': householdId },
      data: {
        name: 'Proveedor local de planificación automática',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-task-planner',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);

    const panel = page.locator('[data-test="planning-automation-settings"]');
    await expect(panel).toBeVisible();
    const generate = panel.locator('[data-test="planning-automation-mode-generate"]');
    await generate.check();
    await panel.locator('[data-test="planning-automation-scope-tasks"]').check();

    const target = dueMadridSchedule();
    const weekdayPicker = panel.locator('[data-test="planning-automation-weekday"] button');
    await weekdayPicker.focus();
    await page.keyboard.press('ArrowDown');
    const weekdayList = panel.getByRole('listbox', { name: 'Día de la semana' });
    await expect(weekdayList).toBeVisible();
    for (let index = 0; index < target.weekday - 1; index += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');
    await panel.locator('[data-test="planning-automation-local-time"]').fill(target.localTime);
    await panel.locator('[data-test="planning-automation-time-zone"]').fill('Europe/Madrid');

    const save = panel.locator('[data-test="planning-automation-save"] button');
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/api/household/planning-automation')
    );
    await save.click();
    expect((await saveResponse).status()).toBe(200);
    await expect(
      panel.getByRole('status').filter({ hasText: 'Configuración guardada' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Reanudar planificación automática' }).click();
    await expect
      .poll(async () => (await readAutomation(page, householdId, token!)).enabled)
      .toBe(true);
    await expect
      .poll(async () => (await readAutomation(page, householdId, token!)).lastRun?.status, {
        timeout: 30_000,
        intervals: [100, 250, 500, 1_000]
      })
      .toBe('completed');

    const targetWeekDate = new Date(`${target.date}T00:00:00.000Z`);
    const daysUntilFollowingMonday = 8 - (targetWeekDate.getUTCDay() || 7);
    targetWeekDate.setUTCDate(targetWeekDate.getUTCDate() + daysUntilFollowingMonday);
    const targetWeekStart = targetWeekDate.toISOString().slice(0, 10);
    const completed = await readAutomation(page, householdId, token!);
    expect(completed.lastRun).toMatchObject({
      targetWeekStart,
      status: 'completed',
      failureCode: null
    });
    expect(completed.enabled).toBe(true);

    const headers = { ...authHeaders, 'x-household-id': householdId };
    const taskResponse = await page.request.get(
      `/api/household/tasks?weekStart=${targetWeekStart}`,
      { headers }
    );
    const taskText = await taskResponse.text();
    expect(taskResponse.status(), taskText).toBe(200);
    const taskWeek = JSON.parse(taskText) as {
      data: {
        weekStart: string;
        version: number;
        tasks: Array<{
          title: string;
          scheduledDate: string;
          assignedMemberId: string | null;
          spaceId: string | null;
        }>;
      };
    };
    expect(taskWeek.data).toMatchObject({
      weekStart: targetWeekStart,
      version: 1,
      tasks: [
        {
          title: 'Revisar la cocina',
          scheduledDate: targetWeekStart,
          assignedMemberId: ownerId,
          spaceId: null
        }
      ]
    });
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]).toMatchObject({
      model: 'synthetic-task-planner',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'household_task_proposal', strict: true }
      }
    });

    const pollCountAfterPublication = await readSchedulerPollCount();
    expect(pollCountAfterPublication).toBeGreaterThan(0);
    await expect
      .poll(readSchedulerPollCount, { timeout: 5_000, intervals: [100, 250, 500] })
      .toBeGreaterThanOrEqual(pollCountAfterPublication + 2);
    const repeatedPollTaskResponse = await page.request.get(
      `/api/household/tasks?weekStart=${targetWeekStart}`,
      { headers }
    );
    const repeatedPollTaskWeek = (await repeatedPollTaskResponse.json()) as typeof taskWeek;
    expect(repeatedPollTaskWeek.data.version).toBe(1);
    expect(repeatedPollTaskWeek.data.tasks).toHaveLength(1);
    expect(providerRequests).toHaveLength(1);
  } finally {
    try {
      if (automationContext) {
        await pauseAutomationForCleanup(
          page,
          automationContext.householdId,
          automationContext.token
        );
      }
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        provider.close((error) => (error ? rejectClose(error) : resolveClose()))
      );
    }
  }
});
