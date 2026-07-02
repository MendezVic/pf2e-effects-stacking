import { chromium, type FullConfig } from '@playwright/test';
import { MODULE_ID, joinAsFirstGm, waitForGameReady } from './fixtures/foundry-clients';

/**
 * Guarantee the world the harness launched has this module enabled before any spec runs. Dev
 * worlds don't enable it by default (module activation is a per-world LevelDB setting, not in
 * world.json), so on first run we flip `core.moduleConfiguration` as GM and reload — what
 * Foundry's Module Management UI does, minus the click. The change persists, so later runs find
 * it already active. Fails loud rather than letting specs run against a world where the module
 * never loaded.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:30005';
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });

  const isActive = () =>
    page.evaluate((id) => !!(window as any).game?.modules?.get(id)?.active, MODULE_ID);

  // The world the harness intended to launch (mirrors playwright.config's webServer env default).
  const expectedWorld = process.env.TEST_WORLD ?? 'pf2e-test';

  try {
    await joinAsFirstGm(page);

    // Guard against a stale/stray server being silently reused (reuseExistingServer): if :30005
    // is some other Foundry or a different world, fail loud instead of testing the wrong target.
    const env = await page.evaluate(() => {
      const g = (window as any).game;
      return { world: g?.world?.id ?? null, system: g?.system?.id ?? null };
    });
    if (env.system !== 'pf2e') {
      throw new Error(`Connected world runs system "${env.system}", expected "pf2e". Wrong/stale server on this port?`);
    }
    if (env.world !== expectedWorld) {
      throw new Error(
        `Connected to world "${env.world}" but TEST_WORLD is "${expectedWorld}". A stray Foundry is being reused — ` +
          `kill it (e.g. lsof -ti:30005 | xargs kill) and re-run, or set TEST_WORLD to match.`,
      );
    }

    if (!(await isActive())) {
      console.log(`[e2e] ${MODULE_ID} not enabled in this world — enabling and reloading…`);
      await page.evaluate(async (id) => {
        const g = (window as any).game;
        const cfg = { ...(g.settings.get('core', 'moduleConfiguration') ?? {}), [id]: true };
        await g.settings.set('core', 'moduleConfiguration', cfg);
      }, MODULE_ID);
      await page.reload();
      await waitForGameReady(page);

      if (!(await isActive())) {
        throw new Error(
          `Set ${MODULE_ID} active in core.moduleConfiguration but it's still inactive after reload. ` +
            `Open the test world once, enable the module in Manage Modules, return to setup, and re-run.`,
        );
      }
    }

    const version = await page.evaluate((id) => (window as any).game?.modules?.get(id)?.version ?? '?', MODULE_ID);
    console.log(`[e2e] ${MODULE_ID} v${version} active in world "${env.world}" (pf2e).`);
  } finally {
    await browser.close();
  }
}
