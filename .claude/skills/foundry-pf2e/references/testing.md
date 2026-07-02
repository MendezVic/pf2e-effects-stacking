# Testing a module: the two-tier harness

This template ships a verification harness so changes can be *proven*, not eyeballed. Two tiers,
deliberately split by what they need to run:

| Tier | Command | Runs on | Proves | Needs |
|------|---------|---------|--------|-------|
| **vitest** | `npm test` | Node, headless | pure logic — schemas, scaling math, parsers, helpers | nothing (zero-setup; the CI tier) |
| **Playwright e2e** | `npm run test:e2e` | a real headless Foundry v14 | the built module actually loads, the UI renders, `game.*` ends up right | a local **licensed** Foundry v14 + a migration-current pf2e world |

**Reach for vitest first.** It's instant, deterministic, and runs anywhere. Push every piece of
logic that *can* be tested without Foundry into a pure module (a `.svelte.ts` runes store, a
`services/` function, a `DataModel` method) and unit-test it there. Use e2e only for what genuinely
needs the live app: hooks firing, documents persisting, the Svelte window rendering in Foundry.

This is your verification loop. After a change, run the tier that covers it and read the result —
don't report "done" on an untested edit.

## vitest tier

- `npm test` — run once (CI uses this).
- `npm run test:watch` — re-run on change while developing.
- `npm run test:ui` — the vitest UI.

Specs are `src/**/*.test.ts`, `environment: 'node'`. The svelte plugin is wired in
`vitest.config.ts` so `.svelte.ts` runes modules compile and can be tested headlessly
(`conditions: ['browser']` makes svelte resolve its client/runes runtime under Node). Import app
code via the `@` alias (`@/constants`, `@/services/...`).

`passWithNoTests: true` is set: the template's only unit spec is the strippable example, so the tier
stays green after `npm run remove-example-files`. Add your own specs and it goes back to enforcing.

## Playwright e2e tier

```bash
npm run setup              # once — caches the Foundry data path in .dev-paths.json
npm run test:e2e:setup     # once — builds test/foundry-data/ (isolated; gitignored)
npx playwright install chromium   # once
TEST_WORLD=<your-pf2e-world> npm run test:e2e       # build dist + run specs
TEST_WORLD=<your-pf2e-world> npm run test:e2e:run   # skip the rebuild (dist must be current)
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:report    # open the last HTML report
npm run test:foundry       # just boot the test Foundry for manual poking
npm run check:e2e          # type-check the e2e specs (separate tsconfig + globals)
```

How it fits together — one service, not two (`src/tests/e2e/README.md` has the full rationale):

```
playwright test
  ├─ webServer:  scripts/start-test-env.sh   → Foundry on :30005, --world=$TEST_WORLD
  ├─ globalSetup: src/tests/e2e/global-setup.ts  → join GM, ensure module enabled, fail loud
  └─ specs:       *.spec.ts                       → drive UI / public API, assert game.*
```

The harness serves the **built** `dist/` bundle from the test Foundry (this repo's `npm run dev` is
a reverse proxy, not a bundle server), so `test:e2e` rebuilds first. Test data lives in
`test/foundry-data/` with `systems`/`modules`/`worlds` **symlinked** from the real data dir and
**no `admin.txt`** (specs join a world as a user, never `/setup`).

### Preconditions (e2e fails loud, but know them up front)

- A **licensed** Foundry v14 installed locally (`start-test-env.sh` finds the app bundle; override
  with `FOUNDRY_APP`).
- `TEST_WORLD` points at a **pf2e** world whose GM has **no password**, already migrated to the
  running core/system version (`--world` won't auto-launch a world that needs migration —
  `global-setup` then reports `No active world at this port`; fix by opening it once in desktop
  Foundry to migrate).
- First run flips `core.moduleConfiguration` to enable the module in that world and reloads — benign,
  but it does mutate the world.

This is why **vitest is the CI tier**: e2e can't run in vanilla CI (no licensed Foundry, no world).

## Check the harness before trusting green

A green run only means something if it ran against the **right** target. `reuseExistingServer` is on
locally, so a stray Foundry on a port gets silently reused. Before trusting an e2e run:

- `global-setup.ts` asserts `game.world.id === TEST_WORLD` and `game.system.id === 'pf2e'` and logs
  the world + module version it exercised. A stale/wrong server fails loud — read that log line.
- Kill strays if anything looks off: `lsof -ti:30005 | xargs kill` (also check `:30000`/`:30001`).
- Make sure the test world isn't open in your desktop Foundry (LevelDB lock).
- If a result surprises you (passes a test you expected to fail, or vice versa), suspect the harness
  before believing the result.

## Authoring a spec when you add a feature

**Unit (preferred):** put the logic in a pure module and test inputs → outputs. No Foundry, no
mocks of `game`. See `src/tests/unit/example.test.ts` for the minimal shape.

**e2e:** add `src/tests/e2e/<operation>.spec.ts` — one operation per file, so a failure names what
broke. Conventions:

- Use the **`gmPage`** fixture from `fixtures/foundry-clients.ts` (worker-scoped GM login, module
  already active). Don't re-implement login.
- Reach Foundry through `page.evaluate(() => game.…)`; drive the UI with your app's **stable**
  selectors (the ApplicationV2 element id, `data-*` hooks — not text or nth-child).
- The world is shared across specs (`workers: 1`). Create throwaway documents named with the
  **`__e2e_`** prefix and delete them in **`afterEach`** — leave the world as you found it.
- Keep `global-setup.ts` and the fixtures generic (game-ready / module-active); put feature-specific
  setup in the spec.

## Strip-on-init lifecycle

The example specs are scaffolding, like `ExampleApp`: `src/tests/e2e/launch.spec.ts` (opens the
example window via `api.open()`) and `src/tests/unit/example.test.ts` are removed by
`npm run remove-example-files`. The **plumbing stays** — `vitest.config.ts`, `playwright.config.ts`,
`scripts/setup-test-env.ts`, `scripts/start-test-env.sh`, and
`src/tests/e2e/{global-setup.ts, fixtures/, tsconfig.json}` are all generic and module-agnostic. So a
freshly-stripped module keeps a working harness with zero example-specific code — write your first
real spec into the same dirs.
