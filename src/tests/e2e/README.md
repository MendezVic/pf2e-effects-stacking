# Playwright e2e harness

Browser-driven verification of the module against a **headless Foundry v14**. The vitest suite
(`src/tests/unit/`) covers pure logic in isolation; these specs drive the real Svelte UI in a real
Foundry and assert against live `game.*` state.

Unlike the vitest tier, e2e is **opt-in**: it needs a locally licensed Foundry v14 and a
migration-current pf2e world, so it can't run in vanilla CI. Vitest is the CI tier.

## How it works

```
playwright test
  ├─ webServer:  bash scripts/start-test-env.sh   → Foundry on :30005, --world=$TEST_WORLD
  ├─ globalSetup: src/tests/e2e/global-setup.ts       → join GM, ensure module enabled, fail loud
  └─ specs:       *.spec.ts                            → drive the UI / public API, assert game.*
```

One service, not two. This repo's `npm run dev` is a *reverse proxy* in front of a separate
Foundry — not a bundle server — and `module.json` loads `dist/` by a relative path. So the harness
serves the **built bundle** from the test Foundry (the module scaffold's `dist` symlink → repo
`dist`) and Playwright talks to :30005 directly. `npm run test:e2e` rebuilds `dist/` first, so specs
always exercise current source. There is no Vite webServer.

## Test data is isolated

`npm run test:e2e:setup` builds `test/foundry-data/` (gitignored): a Foundry data path with its own
`Config/options.json` (port 30005), the activated `license.json` copied in, and **no `admin.txt`**
(so there's no admin password — specs join a world as a user, never `/setup`). `systems`, `modules`,
and `worlds` are **symlinked** from your real Foundry data dir, so tests run against the same pf2e
system, the live module scaffold, and your existing worlds. It reuses the `foundryData` path
`npm run setup` cached in `.dev-paths.json` (or `FOUNDRY_DATA`).

## The test world

Set `TEST_WORLD` to a pf2e world you keep for testing (default `pf2e-test`). The module isn't
enabled in any world by default — module activation is a per-world LevelDB setting, not in
`world.json`. So on first run `global-setup.ts` joins as GM, flips `core.moduleConfiguration` to
enable the module, and reloads (what Foundry's Manage Modules UI does, minus the click). The change
persists, so later runs find it already active. This **enables the module in that world** — benign,
and what you want for testing, but it does mutate the world.

Requirements of whatever world you point at:
- It's a **pf2e** world whose GM user has **no password** (standard for a throwaway world).
- It's already on the **current core + system version** of the running Foundry. `--world` refuses
  to auto-launch a world that needs migration, so `global-setup` fails loud with a hint. Fix: open
  that world once in your desktop Foundry, let it migrate, then `--world` launches it headlessly
  from then on.

If `global-setup` reports `No active world at this port`, the world didn't launch — almost always
the migration gate above.

## Run it

```bash
npm run setup              # once — caches the Foundry data path in .dev-paths.json
npm run test:e2e:setup     # once (and after changing which world dir you mirror)
npx playwright install chromium   # once
TEST_WORLD=my-world npm run test:e2e      # build dist + run specs
TEST_WORLD=my-world npm run test:e2e:run  # skip the rebuild (fast iteration; dist must be current)
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:report    # open the last HTML report
npm run test:foundry       # just boot the test Foundry (manual poking; TEST_WORLD respected)
```

## Check the harness before trusting a run

A green run only means something if it ran against the **right** target. `reuseExistingServer` is on
locally, so a stray Foundry left on a port gets silently reused. Guard rails:

- `global-setup.ts` asserts `game.world.id === TEST_WORLD` and `game.system.id === 'pf2e'` and logs
  the world + module version it actually exercised — a stale/wrong server fails loud.
- Before a run, if anything's off, check for strays and kill them:
  ```bash
  lsof -ti:30005 | xargs kill    # stray test Foundry (also check :30000 / :30001)
  ```
- Make sure the test world isn't open in your normal Foundry (LevelDB lock).

## Conventions for new specs

- Use the `gmPage` fixture from `fixtures/foundry-clients.ts` (worker-scoped GM login, module active).
- Name created documents with the `__e2e_` prefix and delete them in `afterEach`. The world is
  shared — leave it as you found it.
- Reach Foundry APIs with `page.evaluate(() => game.…)`; drive the UI with your app's **stable**
  selectors (the ApplicationV2 element id, `data-*` hooks). The shipped `launch.spec.ts` is the
  minimal example: it opens the app via the public API and asserts the window renders.

`launch.spec.ts` is example scaffolding — `npm run remove-example-files` deletes it along with
`ExampleApp`. The plumbing (this dir's `global-setup.ts`, `fixtures/`, the configs, the scripts)
stays. After stripping, write your first real spec here.
