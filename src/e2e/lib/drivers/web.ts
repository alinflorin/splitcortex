import { expect, type BrowserContext } from '@playwright/test';
import type { NodeDriver } from '../nodeSuite';
import { webNodeUrl } from '../env';

let context: BrowserContext | undefined;

// The browser tab is the node: type the code on web-node.<host>, then it downloads the model into OPFS and serves.
export const webNode: NodeDriver = {
  title: 'web node',
  unavailable: async () => null,
  async join(code, { browser }) {
    await context?.close();
    context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto(webNodeUrl());
    await page.getByLabel('Join code').fill(code);
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    // Enrolled: the node card shows (its title is the device name; "This browser" also appears in the intro text).
    // The node starts by itself once enrolled (its "connect when this page opens" setting): press Start only if it did
    // not, and tolerate it starting while we click.
    const running = page.getByRole('button', { name: 'Stop', exact: true });
    const start = page.getByRole('button', { name: 'Start', exact: true });
    await expect(running.or(start)).toBeVisible();
    if (!(await running.isVisible())) await start.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(running).toBeVisible();
  },
  async stop() {
    await context?.close();
    context = undefined;
  },
};
