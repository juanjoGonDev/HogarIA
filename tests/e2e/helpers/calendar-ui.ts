import { expect, type Page } from '../fixtures';

/** Select a calendar view through the same accessible picker used by mouse and keyboard users. */
export async function selectCalendarView(page: Page, value: string, label: string): Promise<void> {
  const selector = page.locator('[data-test="calendar-view-select"]');
  if (await selector.getAttribute('data-view') === value) return;
  await selector.locator('.picker__trigger').click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(selector).toHaveAttribute('data-view', value);
}
