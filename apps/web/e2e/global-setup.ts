import { chromium, type FullConfig } from '@playwright/test';

/**
 * Loads the sign-in page once before the suite. A cold Vite dev server pre-bundles dependencies on
 * the first page request, which can take longer than a test's timeout; its readiness check passes
 * as soon as index.html is served. A built stack (E2E_BASE_URL) needs no warm-up.
 */
export default async function globalSetup(config: FullConfig) {
  if (process.env.E2E_BASE_URL) return;
  const { baseURL } = config.projects[0]!.use;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto('/login', { timeout: 180_000 });
    await page.getByLabel('Email').waitFor({ timeout: 180_000 });
  } finally {
    await browser.close();
  }
}
