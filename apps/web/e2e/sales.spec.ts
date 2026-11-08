import { expect, test, type Page } from '@playwright/test';
import { STAFF, signIn, signInFromStart, signOut } from './helpers';

const SALES = 'sales@stockflow.test';

async function switchUser(page: Page, email: string) {
  await signOut(page);
  await signIn(page, email);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The status badge next to the page heading. */
async function expectStatus(page: Page, label: string) {
  await expect(
    page.getByRole('heading', { level: 1 }).locator('..').getByText(label, { exact: true }),
  ).toBeVisible();
}

async function selectOption(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

/** On hand and reserved for a product in one warehouse, from the product page. */
async function stockIn(page: Page, productName: string, warehouseCode: string) {
  await page.goto(`/products?search=${encodeURIComponent(productName)}`);
  await page.getByRole('link', { name: productName }).click();
  const cells = page
    .getByRole('row', { name: new RegExp(`${warehouseCode}\\b`) })
    .first()
    .getByRole('cell');
  await expect(cells.nth(1)).not.toBeEmpty();
  return {
    onHand: Number(await cells.nth(1).textContent()),
    reserved: Number(await cells.nth(2).textContent()),
  };
}

async function newOrder(page: Page, customer: string, product: string, quantity: number) {
  await page.goto('/sales-orders/new');
  await selectOption(page, 'Customer', customer);
  await selectOption(page, 'Ship from', 'MAIN — Central Warehouse');
  await page.getByRole('combobox', { name: 'Product for line 1' }).click();
  await page.getByPlaceholder('Search name or SKU').fill(product);
  await page.getByRole('option', { name: new RegExp(product) }).click();
  await page.getByLabel('Quantity for line 1').fill(String(quantity));
}

async function pickPackDispatch(page: Page, orderUrl: string, pickQuantity?: number) {
  await page.goto(orderUrl);
  await page.getByRole('link', { name: 'Create pick list' }).click();
  if (pickQuantity !== undefined) {
    await page.getByLabel(/^Quantity to pick for /).fill(String(pickQuantity));
  }
  await page.getByRole('button', { name: 'Create pick list' }).click();
  await expect(page.getByRole('heading', { name: /^SHP-\d{4}-\d{5}$/ })).toBeVisible();
  const shipmentUrl = page.url();

  await page.getByRole('button', { name: 'Confirm picking' }).click();
  await page.getByRole('button', { name: 'Record packing' }).click();
  const pack = page.getByRole('dialog', { name: 'Record packing' });
  await pack.getByLabel('Total weight (kg)').fill('3.5');
  await pack.getByRole('button', { name: 'Mark as packed' }).click();
  await expectStatus(page, 'Packed');

  await page.getByRole('button', { name: 'Dispatch' }).click();
  const dispatch = page.getByRole('dialog', { name: 'Dispatch shipment' });
  await dispatch.getByLabel('Carrier').fill('Northline Freight');
  await dispatch.getByLabel('Tracking number').fill('NLF-E2E-1');
  await dispatch.getByRole('button', { name: 'Dispatch' }).click();
  await expectStatus(page, 'Dispatched');
  return shipmentUrl;
}

test('order → reserve → pick, pack, dispatch → delivered', async ({ page }) => {
  test.setTimeout(120_000);
  await signInFromStart(page, SALES);
  const before = await stockIn(page, 'Desk Stapler, Full Strip', 'MAIN');

  await newOrder(page, 'Harbour View Dental', 'Desk Stapler', 3);
  await expect(page.getByText(`${before.onHand - before.reserved} pcs`)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and reserve stock' }).click();
  await expect(page.getByRole('heading', { name: /^SO-\d{4}-\d{5}$/ })).toBeVisible();
  await expectStatus(page, 'Confirmed');
  const orderUrl = page.url();
  // Sales managers can't fulfil.
  await expect(page.getByRole('link', { name: 'Create pick list' })).toHaveCount(0);

  const reserved = await stockIn(page, 'Desk Stapler, Full Strip', 'MAIN');
  expect(reserved).toEqual({ onHand: before.onHand, reserved: before.reserved + 3 });

  await switchUser(page, STAFF);
  const shipmentUrl = await pickPackDispatch(page, orderUrl);
  // Stock leaves at dispatch: on hand and reserved both fall by 3.
  expect(await stockIn(page, 'Desk Stapler, Full Strip', 'MAIN')).toEqual({
    onHand: before.onHand - 3,
    reserved: before.reserved,
  });

  await page.goto(shipmentUrl);
  await page.getByRole('button', { name: 'Add tracking update' }).click();
  const tracking = page.getByRole('dialog', { name: 'Add tracking update' });
  await tracking.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Delivered' }).click();
  await tracking.getByRole('button', { name: 'Confirm delivery' }).click();
  await expect(tracking.getByText('Enter who received it')).toBeVisible();
  await tracking.getByLabel('Received by').fill('Front desk');
  await tracking.getByRole('button', { name: 'Confirm delivery' }).click();
  await expect(tracking).toHaveCount(0);
  await expect(page.getByRole('definition').filter({ hasText: 'Front desk' })).toBeVisible();

  await page.goto(orderUrl);
  await expectStatus(page, 'Delivered');
  await expect(page.getByText('Received by Front desk')).toBeVisible();
});

test('refuses to confirm an order the warehouse can’t cover', async ({ page }) => {
  await signInFromStart(page, SALES);
  await newOrder(page, 'Northgate Architects', 'Mechanical Keyboard', 50);
  await expect(page.getByText(/Short by \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and reserve stock' }).click();

  await expect(page.getByRole('heading', { name: /^SO-/ })).toBeVisible();
  await expectStatus(page, 'Draft');
  await expect(
    page.getByText(/saved as draft\. Only \d+ pcs of .+ available in MAIN/),
  ).toBeVisible();
  await expect(page.getByText(/1 line is short in MAIN/)).toBeVisible();
});

test('ships part of an order, then cancels the rest', async ({ page }) => {
  test.setTimeout(120_000);
  await signInFromStart(page, SALES);
  await newOrder(page, 'Kestrel Logistics', 'Multi-Surface Cleaner', 4);
  await page.getByRole('button', { name: 'Confirm and reserve stock' }).click();
  await expectStatus(page, 'Confirmed');
  const orderUrl = page.url();
  const before = await stockIn(page, 'Multi-Surface Cleaner 750ml', 'MAIN');

  await switchUser(page, STAFF);
  await pickPackDispatch(page, orderUrl, 1);
  await page.goto(orderUrl);
  await expectStatus(page, 'Partially shipped');
  await expect(page.getByText('3 units are reserved but not yet on a pick list.')).toBeVisible();

  await switchUser(page, SALES);
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Cancel remaining' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel remaining quantities' });
  await dialog.getByLabel('Reason').fill('Customer found stock locally');
  await dialog.getByRole('button', { name: 'Cancel remaining' }).click();

  await expectStatus(page, 'Shipped');
  await expect(page.getByText('3 cancelled')).toBeVisible();
  expect(await stockIn(page, 'Multi-Surface Cleaner 750ml', 'MAIN')).toEqual({
    onHand: before.onHand - 1,
    reserved: before.reserved - 4,
  });
});

test('cancelling a confirmed order releases its reservation', async ({ page }) => {
  await signInFromStart(page, SALES);
  const before = await stockIn(page, 'Wireless Mouse', 'MAIN');
  await page.goto('/sales-orders?view=toFulfil');
  await page
    .getByRole('row', { name: /Bayside Coworking/ })
    .getByRole('link')
    .first()
    .click();
  await expectStatus(page, 'Confirmed');

  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel sales order' });
  await dialog.getByLabel('Reason').fill('Order placed twice');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expectStatus(page, 'Cancelled');

  const after = await stockIn(page, 'Wireless Mouse', 'MAIN');
  expect(after).toEqual({ onHand: before.onHand, reserved: before.reserved - 6 });
});
