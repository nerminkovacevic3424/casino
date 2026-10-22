import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * End-to-end tests against the real stack. Postgres, Redis and Mailpit must
 * be running and migrated first:
 *   docker compose up -d --wait && pnpm nx run api:migrate
 * Then:
 *   pnpm nx e2e web-e2e
 * Set BASE_URL to test a deployed environment instead (no local servers are started).
 */
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';
const local = !process.env['BASE_URL'];

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  globalSetup: './src/support/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: local
    ? [
        {
          command: 'pnpm exec nx run api:serve',
          url: 'http://localhost:3000/api/health/ready',
          reuseExistingServer: true,
          cwd: workspaceRoot,
          timeout: 180_000,
        },
        {
          command: 'pnpm exec nx run web:serve',
          url: 'http://localhost:4200',
          reuseExistingServer: true,
          cwd: workspaceRoot,
          timeout: 180_000,
        },
      ]
    : undefined,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
