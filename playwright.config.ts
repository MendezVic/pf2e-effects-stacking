import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.TEST_FOUNDRY_PORT ?? 30005);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './src/tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  // Joins a world as GM and ensures this module is enabled (one-time, persisted) before any
  // spec runs. Fails loud if it can't.
  globalSetup: './src/tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    // Foundry refuses to init below 1366×768 (logs an error that can halt module load).
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // One service: a headless test Foundry on :30005 serving the built dist/ bundle via the module
  // scaffold's `dist` symlink. There is NO Vite webServer — `npm run dev` here is a reverse proxy
  // in front of a separate Foundry, not a bundle server, so e2e exercises the built artifact.
  // `npm run test:e2e` rebuilds dist first.
  webServer: {
    command: 'bash scripts/start-test-env.sh',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      TEST_WORLD: process.env.TEST_WORLD ?? 'pf2e-test',
      TEST_FOUNDRY_PORT: String(PORT),
    },
  },
});
