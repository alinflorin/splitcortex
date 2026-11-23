import { expect, type Page } from '@playwright/test';

/**
 * A link of the app's own menus (top bar, drawer) by exact name. The public pages also have a footer with the same
 * links (Home, About, ...), so a bare `getByRole('link', { name })` would match twice there.
 */
export const menuLink = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).and(page.locator(':not(footer a)'));

/**
 * Waits until no dialog is left in the page. A closing Fluent dialog stays in the DOM for its exit animation; a
 * locator like `getByRole('dialog')` used right away would pick that one and lose it while clicking.
 */
export async function dialogsClosed(page: Page) {
  await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toHaveCount(0);
}
