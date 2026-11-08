import { expect, test, type Page } from '@playwright/test';
import { ADMIN, STAFF, signIn, signInFromStart, signOut } from './helpers';

const PROCUREMENT = 'procurement@stockflow.test';

async function switchUser(page: Page, email: string) {
  await signOut(page);
  await signIn(page, email);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function selectOption(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

async function onHandIn(page: Page, productName: string, warehouseCode: string) {
  await page.goto(`/products?search=${encodeURIComponent(productName)}`);
  await page.getByRole('link', { name: productName }).click();
  const row = page.getByRole('row', { name: new RegExp(`${warehouseCode}\\b`) }).first();
  const cells = row.getByRole('cell');
  return Number(await cells.nth(1).textContent());
}

test('request → approval → order → partial and damaged receipt → complete', async ({ page }) => {
  // Four people take part, so this walks through several sign-ins.
  test.setTimeout(120_000);
  await signInFromStart(page, ADMIN);
  const before = await onHandIn(page, 'Wireless Mouse', 'MAIN');

  // Staff raises a request.
  await switchUser(page, STAFF);
  await page.goto('/purchase-requests/new');
  await selectOption(page, 'Deliver to', 'MAIN — Central Warehouse');
  await page.getByRole('combobox', { name: 'Product for line 1' }).click();
  await page.getByPlaceholder('Search name or SKU').fill('Wireless Mouse');
  await page.getByRole('option', { name: /Wireless Mouse/ }).click();
  await page.getByLabel('Quantity for line 1').fill('10');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByRole('heading', { name: /^PR-\d{4}-\d{5}$/ })).toBeVisible();
  await expect(page.getByText('Awaiting approval').first()).toBeVisible();
  const requestUrl = page.url();
  // Staff can't approve.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // Procurement approves and creates the order with a supplier.
  await switchUser(page, PROCUREMENT);
  await page.goto(requestUrl);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create purchase order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create purchase order' });
  await dialog.getByRole('combobox', { name: 'Supplier' }).click();
  await page.getByRole('option', { name: /Volt Distribution/ }).click();
  await expect(dialog.getByRole('cell', { name: '8.46' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create draft order' }).click();

  await expect(page.getByRole('heading', { name: /^PO-\d{4}-\d{5}$/ })).toBeVisible();
  const poUrl = page.url();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(
    page.getByText('You created this order, so someone else must approve it.'),
  ).toBeVisible();

  // Admin approves.
  await switchUser(page, ADMIN);
  await page.goto(poUrl);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

  // Staff receives part of it, with damaged units.
  await switchUser(page, STAFF);
  await page.goto(poUrl);
  await page.getByRole('link', { name: 'Receive goods' }).click();
  await page.getByLabel(/^Accepted for /).fill('6');
  await page.getByLabel(/^Damaged for /).fill('2');
  await page.getByLabel(/^Reason for /).fill('Cracked casings');
  await page.getByLabel('Supplier delivery note').fill('VD-90001');
  await expect(page.getByText('6 units will be added to Central Warehouse')).toBeVisible();
  await page.getByRole('button', { name: 'Post goods receipt' }).click();
  await expect(page.getByRole('heading', { name: /^GRN-\d{4}-\d{5}$/ })).toBeVisible();
  await expect(page.getByText('Cracked casings')).toBeVisible();

  await page.goto(poUrl);
  await expect(page.getByText('Partially received').first()).toBeVisible();
  const line = page.getByRole('row', { name: /Wireless Mouse/ });
  // Ordered 10, received 6, rejected 0, damaged 2, outstanding 4.
  await expect(line.getByRole('cell').nth(1)).toHaveText('10');
  await expect(line.getByRole('cell').nth(2)).toHaveText('6');
  await expect(line.getByRole('cell').nth(4)).toHaveText('2');
  await expect(line.getByRole('cell').nth(5)).toHaveText('4');
  expect(await onHandIn(page, 'Wireless Mouse', 'MAIN')).toBe(before + 6);

  // Replacement delivery completes the order.
  await page.goto(poUrl);
  await page.getByRole('link', { name: 'Receive goods' }).click();
  await page.getByRole('button', { name: 'Accept all outstanding' }).click();
  await page.getByRole('button', { name: 'Post goods receipt' }).click();
  await expect(page.getByRole('heading', { name: /^GRN-/ })).toBeVisible();
  await page.goto(poUrl);
  await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive goods' })).toHaveCount(0);
  expect(await onHandIn(page, 'Wireless Mouse', 'MAIN')).toBe(before + 10);
});

test('procurement creates, then cancels an approved order', async ({ page }) => {
  await signInFromStart(page, PROCUREMENT);
  await page.goto('/purchase-orders/new');
  await selectOption(page, 'Supplier', 'PackRight Supplies');
  await selectOption(page, 'Deliver to', 'NORTH — North Depot');
  await page.getByRole('combobox', { name: 'Product for line 1' }).click();
  await page.getByPlaceholder('Search name or SKU').fill('Bubble Wrap');
  await page.getByRole('option', { name: /Bubble Wrap/ }).click();
  await page.getByLabel('Quantity for line 1').fill('5');
  await expect(page.getByText('Supplier price')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByRole('heading', { name: /^PO-/ })).toBeVisible();
  const poUrl = page.url();

  await switchUser(page, ADMIN);
  await page.goto(poUrl);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel purchase order' });
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(dialog.getByText('Enter a reason')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Ordered from the wrong depot');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();

  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Ordered from the wrong depot').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receive goods' })).toHaveCount(0);
});

test('closes the outstanding quantities of a partially received order', async ({ page }) => {
  await signInFromStart(page, PROCUREMENT);
  await page.goto('/purchase-orders?status=partially_received');
  await page
    .getByRole('row', { name: /Volt Distribution/ })
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByText('Partially received').first()).toBeVisible();

  await page.getByRole('button', { name: 'Close remaining' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close remaining quantities' });
  await dialog.getByLabel('Reason').fill('Keyboards discontinued by the supplier');
  await dialog.getByRole('button', { name: 'Close order' }).click();

  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
  const footer = page.getByRole('row', { name: /^Total/ });
  // Outstanding total drops to 0.
  await expect(footer.getByRole('cell').nth(5)).toHaveText('0');
});

test('supplier page shows delivery history and price list', async ({ page }) => {
  await signInFromStart(page, PROCUREMENT);
  await page.goto('/suppliers');
  await page.getByRole('link', { name: 'Oakridge Furniture Co.' }).click();
  await expect(page.getByRole('heading', { name: 'Oakridge Furniture Co.' })).toBeVisible();
  await expect(page.getByText('Deliveries received')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Ergonomic Office Chair/ }).first()).toBeVisible();
  await expect(page.getByText('On time', { exact: true }).first()).toBeVisible();
});
