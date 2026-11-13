import { expect, test } from '@playwright/test';
import { ADMIN, signInFromStart, uniqueEmail } from './helpers';

test('admin finds a customer by full email and erases their personal data', async ({ page }) => {
  const name = `Erasure Test ${Date.now()}`;
  const email = uniqueEmail('erase');
  await signInFromStart(page, ADMIN);

  await page.goto('/customers');
  await page.getByRole('button', { name: 'Add customer' }).click();
  const add = page.getByRole('dialog', { name: 'Add customer' });
  await add.getByLabel('Name').fill(name);
  await add.getByLabel('Contact person').fill('Robin Ashdown');
  await add.getByLabel('Email').fill(email);
  await add.getByLabel('Shipping address').fill('4 Lantern Row');
  await add.getByRole('button', { name: 'Add customer' }).click();
  await expect(add).toBeHidden();

  // Personal details are encrypted: an email is found only when typed in full.
  const search = page.getByPlaceholder('Search name, code or full email');
  await search.fill(email.slice(0, 8));
  await expect(page.getByText('No customers match these filters.')).toBeVisible();
  await search.fill(email.toUpperCase());
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Robin Ashdown');
  const code = (await row.getByRole('cell').first().textContent())!.trim();

  await row.getByRole('button', { name: `Erase personal data of ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Erase personal data' });
  await dialog.getByLabel('Reason').fill('Erasure request from the customer');
  await dialog.getByLabel(`Type ${code} to confirm`).fill('WRONG');
  await dialog.getByRole('button', { name: 'Erase personal data' }).click();
  await expect(dialog.getByText(`Type ${code} to confirm`).last()).toBeVisible();
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(`Type ${code} to confirm`).fill(code.toLowerCase());
  await dialog.getByRole('button', { name: 'Erase personal data' }).click();
  await expect(dialog).toBeHidden();

  // The email no longer finds them; the business name still does, with nothing personal left.
  await expect(page.getByText('No customers match these filters.')).toBeVisible();
  await search.fill(name);
  await expect(row).toBeVisible();
  await expect(row.getByText('Erased', { exact: true })).toBeVisible();
  await expect(row).not.toContainText('Robin Ashdown');
  await expect(row.getByRole('button', { name: `Edit ${name}` })).toHaveCount(0);
});
