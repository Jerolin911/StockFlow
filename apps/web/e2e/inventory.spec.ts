import { expect, test, type Page } from '@playwright/test';
import { INVENTORY, STAFF, signInFromStart } from './helpers';

const PROCUREMENT = 'procurement@stockflow.test';

async function selectOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function pickProduct(page: Page, line: number, search: string) {
  await page.getByRole('combobox', { name: `Product for line ${line}` }).click();
  await page.getByPlaceholder('Search name or SKU').fill(search);
  await page.getByRole('option').filter({ hasText: search }).first().click();
}

async function addProduct(page: Page, name: string, sku = '') {
  await page.goto('/products');
  await page.getByRole('button', { name: 'Add product' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add product' });
  await dialog.getByLabel('Product name').fill(name);
  if (sku) await dialog.getByLabel('SKU').fill(sku);
  await dialog.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Electronics (ELC)' }).click();
  await dialog.getByLabel('Cost price').fill('12.40');
  await dialog.getByLabel('Selling price').fill('24.99');
  await dialog.getByLabel('Low-stock threshold').fill('10');
  await dialog.getByRole('button', { name: 'Add product' }).click();
  return dialog;
}

test('inventory manager adds a product, registers opening stock and adjusts it', async ({
  page,
}) => {
  const name = `Docking Station ${Date.now()}`;
  await signInFromStart(page, INVENTORY);

  await addProduct(page, name);
  // Creating a product opens its detail page with the generated SKU.
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const sku = (await page
    .getByText(/^ELC-\d{5}$/)
    .first()
    .textContent())!;
  await expect(page.getByText('Not stocked in any warehouse yet.')).toBeVisible();

  await page.getByRole('link', { name: 'Opening stock' }).click();
  await expect(page.getByRole('heading', { name: 'Register opening stock' })).toBeVisible();
  await selectOption(page, 'Warehouse', 'MAIN — Central Warehouse');
  await expect(page.getByRole('combobox', { name: 'Product for line 1' })).toContainText(sku);
  await page.getByLabel('Quantity for line 1').fill('25');
  await page.getByRole('button', { name: 'Register opening stock' }).click();

  await expect(page).toHaveURL(/\/stock\/adjustments\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading', { name: /^OPN-\d{4}-\d{5}$/ })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(sku) })).toContainText('+25');

  // Stock-out adjustment.
  await page.goto('/stock/adjustments/new?type=adjustment');
  await selectOption(page, 'Warehouse', 'MAIN — Central Warehouse');
  await selectOption(page, 'Reason', 'Damaged');
  await pickProduct(page, 1, sku);
  const line = page
    .getByRole('row')
    .filter({ has: page.getByRole('combobox', { name: 'Product for line 1' }) });
  await expect(line).toContainText('25 pcs');
  await page.getByLabel('Quantity change for line 1').fill('-7');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByRole('heading', { name: /^ADJ-\d{4}-\d{5}$/ })).toBeVisible();

  // Ledger shows both directions with running balances.
  await page.goto('/stock/movements');
  await page
    .getByRole('row', { name: new RegExp(sku) })
    .first()
    .getByRole('link', { name })
    .click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const stockRow = page.getByRole('row', { name: /MAIN/ }).first();
  await expect(stockRow).toContainText('18');
  const ledger = page.getByRole('row').filter({ hasText: /OPN-|ADJ-/ });
  await expect(ledger).toHaveCount(2);
  await expect(ledger.nth(0)).toContainText('−7');
  await expect(ledger.nth(1)).toContainText('+25');

  await page.goto(`/stock/movements?direction=out`);
  await expect(page.getByRole('row', { name: new RegExp(sku) })).toHaveCount(1);
});

test('rejects a duplicate SKU with a field error', async ({ page }) => {
  await signInFromStart(page, INVENTORY);
  const dialog = await addProduct(page, 'Duplicate SKU attempt', 'elc-00001');
  await expect(dialog.getByText('This SKU is already in use')).toBeVisible();
});

test('refuses to remove more stock than is available', async ({ page }) => {
  await signInFromStart(page, INVENTORY);
  await page.goto('/stock/adjustments/new?type=adjustment');
  await selectOption(page, 'Warehouse', 'MAIN — Central Warehouse');
  await selectOption(page, 'Reason', 'Lost or stolen');
  await pickProduct(page, 1, '4-Drawer Filing Cabinet');
  await page.getByLabel('Quantity change for line 1').fill('-50');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByText(/Only 2 pcs of FUR-\d{5} available/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/stock\/adjustments\/new/);
});

test('dashboard lists low stock and links to the filtered stock levels', async ({ page }) => {
  await signInFromStart(page, STAFF);
  await expect(page.getByText(/5 product–warehouse combinations are at or below/)).toBeVisible();
  await page.getByRole('link', { name: 'View all low stock' }).click();
  await expect(page).toHaveURL(/\/stock\?status=low$/);
  await expect(page.getByText('1–5 of 5')).toBeVisible();
});

test('staff can view inventory but not change it', async ({ page }) => {
  await signInFromStart(page, STAFF);
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add product' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Wireless Mouse' }).click();
  await expect(page.getByRole('link', { name: 'Adjust stock' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  await page.goto('/stock/adjustments/new');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('procurement manager adds a supplier with a generated code', async ({ page }) => {
  const name = `Lumen Lighting ${Date.now()}`;
  await signInFromStart(page, PROCUREMENT);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Suppliers' })
    .click();
  await page.getByRole('button', { name: 'Add supplier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add supplier' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Email').fill('orders@lumen.test');
  await dialog.getByLabel('Lead time (days)').fill('6');
  await dialog.getByRole('button', { name: 'Add supplier' }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel('Search suppliers').fill('Lumen');
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText(/SUP-\d{4}/);
  await expect(row).toContainText('6 days');

  // Procurement can't manage customers.
  await page.goto('/customers');
  await expect(page.getByRole('button', { name: 'Add customer' })).toHaveCount(0);
});

test('inventory manager adds a warehouse and sees it in pickers', async ({ page }) => {
  const code = `W${Date.now().toString().slice(-6)}`;
  await signInFromStart(page, INVENTORY);
  await page.goto('/warehouses');
  await page.getByRole('button', { name: 'Add warehouse' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add warehouse' });
  await dialog.getByLabel('Code').fill(code);
  await dialog.getByLabel('Name').fill('Overflow Unit');
  await dialog.getByRole('button', { name: 'Add warehouse' }).click();
  await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('Overflow Unit');

  await page.goto('/stock/adjustments/new?type=opening');
  await page.getByRole('combobox', { name: 'Warehouse' }).click();
  await expect(page.getByRole('option', { name: `${code} — Overflow Unit` })).toBeVisible();
});
