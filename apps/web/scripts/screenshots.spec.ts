import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const OUT = new URL('../../../docs/screenshots/', import.meta.url).pathname.replace(
  /^\/(\w:)/,
  '$1',
);
const PASSWORD = process.env.SEED_PASSWORD || 'StockFlow-Demo-2026';
mkdirSync(OUT, { recursive: true });

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function shot(page: Page, name: string, path?: string) {
  if (path) await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}${name}.png` });
}

/** Opens the first record in the list at `path`. */
async function firstRecord(page: Page, path: string, name: string) {
  await page.goto(path);
  await page.locator('tbody a').first().click();
  await shot(page, name);
}

test('README screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}login.png` });

  await signIn(page, 'admin@stockflow.test');
  await shot(page, 'dashboard', '/');
  await shot(page, 'products', '/products');
  await shot(page, 'stock-levels', '/stock');
  await firstRecord(page, '/purchase-orders?status=partially_received', 'purchase-order');
  await firstRecord(page, '/sales-orders?status=confirmed', 'sales-order');
  await firstRecord(page, '/shipments', 'shipment');
  await firstRecord(page, '/stock/transfers', 'transfer');
  await shot(page, 'analytics-inventory', '/reports/inventory');
  await shot(page, 'analytics-sales', '/reports/sales');
  await shot(page, 'audit-log', '/audit-log');

  await page.goto('/api/v1/docs/');
  await page.getByText('Purchase orders', { exact: true }).first().waitFor();
  await page.screenshot({ path: `${OUT}api-docs.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'mobile-dashboard', '/');
});
