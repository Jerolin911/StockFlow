import { expect, test, type Page } from '@playwright/test';
import { INVENTORY, STAFF, signIn, signInFromStart, signOut } from './helpers';

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

async function pickProduct(page: Page, line: number, product: string) {
  await page.getByRole('combobox', { name: `Product for line ${line}` }).click();
  await page.getByPlaceholder('Search name or SKU').fill(product);
  await page.getByRole('option', { name: new RegExp(product) }).click();
}

/** Usable on hand and quarantine for a product in a warehouse, from the product page. */
async function stockIn(page: Page, productName: string, warehouseCode: string) {
  await page.goto(`/products?search=${encodeURIComponent(productName)}`);
  await page.getByRole('link', { name: productName }).click();
  await expect(page.getByRole('heading', { name: productName })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(`^${warehouseCode}\\b`) });
  if ((await row.count()) === 0) return { onHand: 0, quarantine: 0 };
  const cells = row.first().getByRole('cell');
  return {
    onHand: Number(await cells.nth(1).textContent()),
    quarantine: Number(await cells.nth(4).textContent()),
  };
}

test('transfer: request → approve → dispatch → partial receipt with damage → close short', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInFromStart(page, STAFF);
  const source = await stockIn(page, 'Ballpoint Pen, Blue (box of 50)', 'MAIN');

  await page.goto('/stock/transfers/new');
  await selectOption(page, 'From', 'MAIN — Central Warehouse');
  await selectOption(page, 'To', 'STORE — City Store Room');
  await pickProduct(page, 1, 'Ballpoint Pen');
  await page.getByLabel('Quantity for line 1').fill('6');
  await page.getByRole('button', { name: 'Request transfer' }).click();
  await expect(page.getByRole('heading', { name: /^TRF-\d{4}-\d{5}$/ })).toBeVisible();
  await expectStatus(page, 'Awaiting approval');
  const url = page.url();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await switchUser(page, INVENTORY);
  await page.goto(url);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expectStatus(page, 'Approved');

  await switchUser(page, STAFF);
  await page.goto(url);
  await page.getByRole('button', { name: 'Dispatch' }).click();
  const dispatch = page.getByRole('dialog', { name: 'Dispatch transfer' });
  await dispatch.getByLabel('Carrier').fill('Own van');
  await dispatch.getByRole('button', { name: 'Dispatch' }).click();
  await expectStatus(page, 'In transit');
  expect((await stockIn(page, 'Ballpoint Pen, Blue (box of 50)', 'MAIN')).onHand).toBe(
    source.onHand - 6,
  );

  await page.goto(url);
  await page.getByLabel(/^Received for /).fill('4');
  await page.getByLabel(/^Damaged for /).fill('1');
  await page.getByRole('button', { name: 'Record receipt' }).click();
  await expectStatus(page, 'Partially received');
  expect(await stockIn(page, 'Ballpoint Pen, Blue (box of 50)', 'STORE')).toEqual({
    onHand: 4,
    quarantine: 1,
  });

  await switchUser(page, INVENTORY);
  await page.goto(url);
  await page.getByRole('button', { name: 'Close short' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close short' });
  await dialog.getByLabel('Reason').fill('One box fell off the van');
  await dialog.getByRole('button', { name: 'Write off and close' }).click();
  await expectStatus(page, 'Closed short');
  await page.getByRole('link', { name: /^ADJ-/ }).click();
  await expect(page.getByText('Lost in transit')).toBeVisible();
});

test('count: finish the seeded count, review variances with reasons and post', async ({ page }) => {
  test.setTimeout(90_000);
  await signInFromStart(page, INVENTORY);
  await page.goto('/stock/counts?status=counting');
  await page.getByRole('row', { name: /NORTH/ }).getByRole('link').first().click();
  await expectStatus(page, 'Counting');

  // Blind count by default; reveal system quantities to fill the uncounted lines.
  await expect(page.getByRole('columnheader', { name: 'System' })).toHaveCount(0);
  await page.getByLabel('Show system quantities').click();
  const rows = page.getByRole('row').filter({ has: page.getByLabel(/^Counted quantity for /) });
  for (let i = 0; i < (await rows.count()); i++) {
    const input = rows.nth(i).getByLabel(/^Counted quantity for /);
    if ((await input.inputValue()) === '') {
      await input.fill((await rows.nth(i).getByRole('cell').nth(1).textContent())!.trim());
    }
  }
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expectStatus(page, 'Awaiting review');

  // The seeded sheet has one line two short.
  await expect(page.getByText(/1 of 5 products differ from stock/)).toBeVisible();
  await page.getByRole('button', { name: 'Post variances' }).click();
  await expect(page.getByText('Choose a reason')).toBeVisible();
  await page.getByRole('combobox', { name: /^Reason for / }).click();
  await page.getByRole('option', { name: 'Damaged' }).click();
  await page.getByLabel(/^Note for /).fill('Two files crushed under a pallet');
  await page.getByRole('button', { name: 'Post variances' }).click();
  await expectStatus(page, 'Posted');

  await page.getByRole('link', { name: /^ADJ-/ }).click();
  await expect(page.getByRole('link', { name: /^CNT-/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Damaged' })).toBeVisible();
});

test('customer return: request → approve → receive into quarantine → inspect and restock', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInFromStart(page, SALES);
  const before = await stockIn(page, 'A4 Copy Paper 80gsm (500 sheets)', 'MAIN');

  // The seeded Harbour View Dental order (paper and sticky notes) is the only one with a
  // customer return, so reach it through that return; the demo history adds other delivered
  // orders for the same customer.
  await page.goto('/customer-returns');
  await page
    .getByRole('row', { name: /Harbour View Dental/ })
    .first()
    .getByRole('link')
    .first()
    .click();
  await page
    .getByRole('link', { name: /^SO-\d{4}-\d{5}$/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'Create return' }).click();
  await selectOption(page, 'Reason', 'Damaged');
  await page.getByLabel(/^Quantity to return for OFF-00001/).fill('3');
  await page.getByRole('button', { name: 'Raise return' }).click();
  await expect(page.getByRole('heading', { name: /^RMA-\d{4}-\d{5}$/ })).toBeVisible();
  const url = page.url();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expectStatus(page, 'Approved');
  await expect(page.getByRole('button', { name: 'Record receipt' })).toHaveCount(0);

  await switchUser(page, STAFF);
  await page.goto(url);
  await page.getByRole('button', { name: 'Record receipt' }).click();
  await expectStatus(page, 'Awaiting inspection');
  const received = await stockIn(page, 'A4 Copy Paper 80gsm (500 sheets)', 'MAIN');
  expect(received).toEqual({ onHand: before.onHand, quarantine: before.quarantine + 3 });

  await page.goto(url);
  await page.getByLabel(/^Quantity to restock for /).fill('2');
  await page.getByLabel(/^Condition note for /).fill('One ream soaked');
  await page.getByRole('button', { name: 'Complete inspection' }).click();
  await expectStatus(page, 'Completed');
  expect(await stockIn(page, 'A4 Copy Paper 80gsm (500 sheets)', 'MAIN')).toEqual({
    onHand: before.onHand + 2,
    quarantine: before.quarantine + 1,
  });
});

test('supplier return: send the approved return of quarantined goods', async ({ page }) => {
  await signInFromStart(page, STAFF);
  const before = await stockIn(page, 'Bubble Wrap Roll 500mm × 50m', 'MAIN');
  await page.goto('/supplier-returns?status=approved');
  await page
    .getByRole('row', { name: /PackRight/ })
    .getByRole('link')
    .first()
    .click();
  await page.getByRole('button', { name: 'Send to supplier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send to supplier' });
  await dialog.getByLabel('Supplier return authorisation').fill('PR-RA-7781');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expectStatus(page, 'Returned');
  expect(await stockIn(page, 'Bubble Wrap Roll 500mm × 50m', 'MAIN')).toEqual({
    onHand: before.onHand,
    quarantine: before.quarantine - 2,
  });
});

test('quarantine damaged stock, then reverse an adjustment', async ({ page }) => {
  await signInFromStart(page, INVENTORY);
  const before = await stockIn(page, 'Cat6 Patch Cable 2m', 'MAIN');

  await page.goto('/stock/quarantine');
  await page.getByRole('button', { name: 'Record a quarantine change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Quarantine change' });
  await selectOption(page, 'Warehouse', 'MAIN — Central Warehouse');
  await selectOption(page, 'Reason', 'Damaged');
  await pickProduct(page, 1, 'Cat6 Patch Cable');
  await dialog.getByLabel('Quantity for line 1').fill('5');
  await dialog.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByRole('heading', { name: /^QTN-/ })).toBeVisible();
  expect(await stockIn(page, 'Cat6 Patch Cable 2m', 'MAIN')).toEqual({
    onHand: before.onHand - 5,
    quarantine: before.quarantine + 5,
  });

  await page.goto('/stock/adjustments?type=adjustment');
  await page
    .getByRole('row', { name: /Damaged/ })
    .last()
    .getByRole('link')
    .first()
    .click();
  const heading = page.getByRole('heading', { level: 1, name: /^ADJ-/ });
  await expect(heading).toBeVisible();
  const original = (await heading.textContent())!;
  await page.getByRole('button', { name: 'Reverse' }).click();
  const reverse = page.getByRole('dialog', { name: `Reverse ${original}` });
  await reverse.getByLabel('Reason').fill('Damage was recorded in the wrong warehouse');
  await reverse.getByRole('button', { name: 'Post reversal' }).click();
  await expectStatus(page, 'Reversal');
  await expect(page.getByRole('link', { name: original })).toBeVisible();
  await page.getByRole('link', { name: original }).click();
  await expectStatus(page, 'Reversed');
  await expect(page.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
});
