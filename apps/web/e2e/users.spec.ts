import { expect, test, type Page } from '@playwright/test';
import { ADMIN, signIn, signInFromStart, signOut, uniqueEmail } from './helpers';

const TEMP_PASSWORD = 'temporary-pass-123';

async function addUser(page: Page, name: string, email: string, role: string) {
  await page.getByRole('button', { name: 'Add user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add user' });
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: role }).click();
  await dialog.getByLabel('Temporary password').fill(TEMP_PASSWORD);
  await dialog.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog).toBeHidden();
}

test('admin adds a user who must change the temporary password at first sign-in', async ({
  page,
}) => {
  const email = uniqueEmail('jordan');
  await signInFromStart(page, ADMIN);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }).click();

  await addUser(page, 'Jordan Ellis', email, 'Procurement Manager');
  const row = page.getByRole('row', { name: /Jordan Ellis/ });
  await expect(row).toContainText('Procurement Manager');
  await expect(row).toContainText('Password change pending');

  await signOut(page);
  await signIn(page, email, TEMP_PASSWORD);
  await expect(page).toHaveURL(/\/change-password$/);

  // Every other page redirects until the password is changed.
  await page.goto('/');
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel('Temporary password').fill(TEMP_PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill('jordans-new-password');
  await page.getByLabel('Confirm new password').fill('jordans-new-password');
  await page.getByRole('button', { name: 'Change password' }).click();

  await expect(page.getByText('Signed in as Jordan Ellis · Procurement Manager')).toBeVisible();
  await expect(page.getByText('Approve purchase orders')).toBeVisible();
});

test('rejects a duplicate email with a field error', async ({ page }) => {
  await signInFromStart(page, ADMIN);
  await page.goto('/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add user' });
  await dialog.getByLabel('Full name').fill('Duplicate Person');
  await dialog.getByLabel('Email').fill('staff@stockflow.test');
  await dialog.getByRole('button', { name: 'Generate' }).click();
  await dialog.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog.getByText('A user with this email already exists')).toBeVisible();
});

test('admin filters users and deactivates an account, which blocks sign-in', async ({ page }) => {
  const email = uniqueEmail('casey');
  await signInFromStart(page, ADMIN);
  await page.goto('/users');
  await addUser(page, 'Casey Morgan', email, 'Staff');

  await page.getByLabel('Search users').fill('Casey');
  await expect(page).toHaveURL(/search=Casey/);
  await expect(page.getByRole('row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Actions for Casey Morgan' }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  await page
    .getByRole('dialog', { name: 'Deactivate user' })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(page.getByRole('row', { name: /Casey Morgan/ })).toContainText('Deactivated');

  await signOut(page);
  await signIn(page, email, TEMP_PASSWORD);
  await expect(page.getByText('This account has been deactivated')).toBeVisible();
});

test('admin cannot change their own role or deactivate themselves', async ({ page }) => {
  await signInFromStart(page, ADMIN);
  await page.goto('/users?search=admin%40stockflow.test');

  await page.getByRole('button', { name: 'Actions for Dana Whitfield' }).click();
  await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Reset password' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit user' });
  await expect(dialog.getByRole('combobox', { name: 'Role' })).toBeDisabled();
});
