import type { Page } from '@playwright/test';
import type { AiFunctionKey } from '../../../frontend/src/app/shared/models/ai-config.model';

/** Enables one AI function for UI flows whose generated response is stubbed separately. */
export async function mockAiFunctionAvailable(
  page: Page,
  functionKeys: AiFunctionKey | AiFunctionKey[]
): Promise<void> {
  const functions = Object.fromEntries(
    (Array.isArray(functionKeys) ? functionKeys : [functionKeys]).map((functionKey) => [
      functionKey,
      true
    ])
  ) as Partial<Record<AiFunctionKey, boolean>>;

  await page.route('**/api/ai/availability', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          hasActiveProvider: true,
          functions,
          requiresHouseholdSelection: false
        }
      })
    });
  });
}
