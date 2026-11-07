import { expect, type Locator, type Page } from '@playwright/test';

const NEW_LIST_ACTIONS = '[data-test="new-list"]:visible, [data-test="new-list-text"]:visible';

/** Returns the create-list control currently exposed by the responsive UI. */
export function shoppingNewListAction(page: Page): Locator {
  return page.locator(NEW_LIST_ACTIONS).first();
}

/** Dismisses the shared optional location flow after a test marks one item as purchased. */
export async function skipOptionalShoppingLocationPrompt(page: Page): Promise<void> {
  const prompt = page.locator('[data-test="location-prompt"]');
  await expect(prompt).toBeVisible();
  await page.locator('[data-test="location-skip"] button').click();
  await expect(prompt).toHaveCount(0);
}

/** Opens the mobile drawer when needed, then follows the real shopping navigation link. */
export async function navigateToShopping(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1024;
  if (width < 1024) await page.locator('.header__menu').click();

  const shoppingLink = page.locator('.sidebar__nav a[href="/shopping"]');
  await expect(shoppingLink).toBeVisible();
  await shoppingLink.click();
}
