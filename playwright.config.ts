import { defineConfig, devices } from '@playwright/test';

// Browser-E2E gegen das gebaute `backe ui` (`dist/`); `mise run e2e` baut vorher. Jeder Test
// startet sein eigenes Zuhause und seinen eigenen Server (`test/browser/fixture.ts`).
const ci = process.env.CI !== undefined && process.env.CI !== '';

export default defineConfig({
  testDir: 'test/browser',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
