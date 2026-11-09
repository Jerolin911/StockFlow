import { defineConfig, devices } from '@playwright/test';

/**
 * Captures the README screenshots from a running, seeded stack:
 *   SCREENSHOT_BASE_URL=http://localhost:8080 npm run screenshots -w @stockflow/web
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:8080',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
});
