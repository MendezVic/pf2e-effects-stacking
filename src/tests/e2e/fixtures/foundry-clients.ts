import { test as base, type Page, type BrowserContext } from '@playwright/test';

declare global {
  // Foundry's runtime globals on `window`. Declared `any` — specs reach into them loosely and
  // the foundry-pf2e typings aren't on the e2e tsconfig's `types`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-var
  var game: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-var
  var ui: any;
}

export const MODULE_ID = 'pf2e-effects-stacking';

/** Drive Foundry's /join screen to log this context in as a specific user. */
export async function joinAs(page: Page, userId: string, password = ''): Promise<void> {
  await page.goto('/join');
  await page.selectOption('select[name="userid"]', userId);
  if (password) await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/game\b/, { timeout: 30_000 }),
    page.click('button[name="join"]'),
  ]);
  await waitForGameReady(page);
}

/** Join as the world's first GM (role ≥ 4). The test worlds use password-less users. */
export async function joinAsFirstGm(page: Page): Promise<void> {
  await page.goto('/join');
  await page.waitForLoadState('networkidle');
  const state = await page.evaluate(() => {
    const g = (window as any).game;
    return {
      view: g?.view ?? null,
      world: g?.world?.id ?? null,
      gmId: (Array.from(g?.users?.values?.() ?? []) as any[]).find((u) => u.role >= 4)?.id ?? null,
    };
  });
  // No active world → Foundry bounced us to /setup. The usual cause is a world that needs
  // migration (older core/system than the running build); --world won't auto-launch those.
  if (state.view !== 'join' || !state.world) {
    throw new Error(
      `No active world at this port (Foundry view: "${state.view}"). The requested world likely needs ` +
        `migration — launch it once in your desktop Foundry to migrate it to the current build, then re-run. ` +
        `Or set TEST_WORLD to a world already on the current core/system version.`,
    );
  }
  if (!state.gmId) throw new Error(`World "${state.world}" has no password-less GM user (role ≥ 4) on /join`);
  await joinAs(page, state.gmId);
}

/** Wait for `game.ready === true`. */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).game?.ready === true, undefined, { timeout: 30_000 });
}

/** Wait for this module to be active: `game.modules.get(MODULE_ID).active`. */
export async function waitForModuleActive(page: Page): Promise<void> {
  await page.waitForFunction(
    (id) => !!(window as any).game?.modules?.get(id)?.active,
    MODULE_ID,
    { timeout: 60_000 },
  );
}

type WorkerFixtures = {
  gmContext: BrowserContext;
  gmPage: Page;
};

/**
 * `gmPage` — a worker-scoped context logged into the test world as the first GM, with this
 * module active. Worker scope means one login for the whole suite (workers: 1); per-test
 * isolation comes from each spec creating throwaway `__e2e_`-named documents and deleting them
 * in `afterEach`, not from tearing down the browser.
 */
export const test = base.extend<object, WorkerFixtures>({
  gmContext: [
    async ({ browser }, use) => {
      const ctx = await browser.newContext();
      await use(ctx);
      await ctx.close();
    },
    { scope: 'worker' },
  ],
  gmPage: [
    async ({ gmContext }, use) => {
      const page = await gmContext.newPage();
      await joinAsFirstGm(page);
      await waitForModuleActive(page);
      // Foundry's permanent warning toasts overlay the app's top bar and intercept clicks. Each
      // `.notification` sets `pointer-events: all`, so hide the stack outright — notifications are
      // informational in tests.
      await page.addStyleTag({ content: '#notifications { display: none !important; }' });
      await use(page);
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
