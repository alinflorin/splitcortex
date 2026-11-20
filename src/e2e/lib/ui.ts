import { expect, type Page } from '@playwright/test';

/**
 * Waits until no dialog is left in the page. A closing Fluent dialog stays in the DOM for its exit animation; a
 * locator like `getByRole('dialog')` used right away would pick that one and lose it while clicking.
 */
export async function dialogsClosed(page: Page) {
  await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toHaveCount(0);
}
