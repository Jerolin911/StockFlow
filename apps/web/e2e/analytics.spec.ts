import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, INVENTORY, STAFF, signIn, signInFromStart, signOut } from './helpers';

const SALES = 'sales@stockflow.test';

async function switchUser(page: Page, email: string) {
  await signOut(page);
  await signIn(page, email);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The number shown in a dashboard stat tile. */
async function tileValue(page: Page, label: string) {
  const tile = page.getByRole('link').filter({ has: page.getByText(label, { exact: true }) });
  return Number((await tile.locator('p').nth(1).textContent())!.replace(/,/g, ''));
}

test('dashboard figures match the records they summarise', async ({ page }) => {
  await signInFromStart(page, INVENTORY);
  const low = await tileValue(page, 'Low stock');
  const products = await tileValue(page, 'Active products');

  await page
    .getByRole('link')
    .filter({ has: page.getByText('Low stock', { exact: true }) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/stock\?status=low/);
  await expect(page.getByText(new RegExp(`1–${low} of ${low}`))).toBeVisible();

  await page.goto('/products?status=active');
  await expect(page.getByText(new RegExp(`of ${products}$`))).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Warehouse distribution' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Units on hand by warehouse' }).getByText('Central Warehouse'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent inventory movements' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending work' })).toBeVisible();
});

test('inventory analytics filter by date range and export CSV', async ({ page }) => {
  await signInFromStart(page, INVENTORY);
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page).toHaveURL(/\/reports\/inventory/);
  await expect(page.getByRole('heading', { name: 'Stock movement' })).toBeVisible();
  // Inventory managers see only their tab.
  await expect(page.getByRole('navigation', { name: 'Report sections' })).toHaveCount(0);

  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  const chart = page.getByRole('figure', { name: 'Units in and out' });
  await chart.getByRole('button', { name: 'Show table' }).click();
  // Seven daily rows plus the header.
  await expect(chart.getByRole('row')).toHaveCount(8);

  await page.getByRole('combobox', { name: 'Filter by movement' }).click();
  await page.getByRole('option', { name: 'Slow-moving' }).click();
  const velocity = page
    .getByRole('heading', { name: 'Fast- and slow-moving products' })
    .locator('xpath=ancestor::*[@data-slot="card"][1]');
  await expect(velocity.getByText('Slow-moving').first()).toBeVisible();
  await expect(velocity.getByText('Fast-moving')).toHaveCount(0);

  const availability = page
    .getByRole('heading', { name: 'Inventory availability' })
    .locator('xpath=ancestor::*[@data-slot="card"][1]');
  const download = page.waitForEvent('download');
  await availability.getByRole('button', { name: 'CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('inventory-availability.csv');
  const csv = await readFile((await file.path())!, 'utf8');
  expect(csv.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
    'SKU,Product,Category,On hand,Reserved,Available,Quarantine,Incoming,In transit,Reorder point,Status',
  );
  expect(csv).toContain('A4 Copy Paper 80gsm (500 sheets)');
});

test('admins see every analytics tab; staff and sales see only what they may', async ({ page }) => {
  await signInFromStart(page, ADMIN);
  await page.goto('/reports');
  const tabs = page.getByRole('navigation', { name: 'Report sections' });
  await expect(tabs.getByRole('link')).toHaveText(['Inventory', 'Procurement', 'Sales']);
  await tabs.getByRole('link', { name: 'Procurement' }).click();
  await expect(page.getByRole('heading', { name: 'Supplier delivery performance' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volt Distribution Ltd' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending purchase quantities' })).toBeVisible();

  await switchUser(page, SALES);
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/reports\/sales/);
  await expect(page.getByRole('heading', { name: 'Top-selling products' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /A4 Copy Paper/ })).toBeVisible();
  await page.goto('/reports/inventory');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();

  await switchUser(page, STAFF);
  await expect(page.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('a transfer request notifies the approver, who opens it from the bell', async ({ page }) => {
  await signInFromStart(page, STAFF);
  await page.goto('/stock/transfers/new');
  await page.getByRole('combobox', { name: 'From' }).click();
  await page.getByRole('option', { name: /^MAIN/ }).click();
  await page.getByRole('combobox', { name: 'To' }).click();
  await page.getByRole('option', { name: /^NORTH/ }).click();
  await page.getByRole('combobox', { name: 'Product for line 1' }).click();
  await page.getByPlaceholder('Search name or SKU').fill('Desk Stapler');
  await page.getByRole('option', { name: /Desk Stapler/ }).click();
  await page.getByLabel('Quantity for line 1').fill('1');
  await page.getByRole('button', { name: 'Request transfer' }).click();
  const number = (await page.getByRole('heading', { name: /^TRF-/ }).textContent())!;

  await switchUser(page, INVENTORY);
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  const before = Number((await bell.getAttribute('aria-label'))!.match(/\d+/)![0]);
  await bell.click();
  await expect(page.getByText('Waiting for your approval')).toBeVisible();
  await page.getByRole('menuitem', { name: new RegExp(`${number} needs approval`) }).click();
  await expect(page.getByRole('heading', { name: number })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Notifications, ${before - 1} unread` }),
  ).toBeVisible();

  await page.goto('/notifications?unread=true');
  await expect(page.getByRole('link', { name: `${number} needs approval` })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});
