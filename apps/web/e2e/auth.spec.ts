import { expect, test } from '@playwright/test';
import { ADMIN, INVENTORY, STAFF, signIn, signInFromStart, signOut } from './helpers';

test('redirects to sign-in and returns to the requested page afterwards', async ({ page }) => {
  await page.goto('/users?role=staff');
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/users\?role=staff$/);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
});

test('shows an error for wrong credentials', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, ADMIN, 'not-the-password');
  await expect(page.getByText('Incorrect email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('validates the sign-in form before submitting', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await expect(page.getByText('Enter your password')).toBeVisible();
});

test('keeps the session across a reload and ends it on sign-out', async ({ page }) => {
  await signInFromStart(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await signOut(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('signed-in users are sent away from the sign-in page', async ({ page }) => {
  await signInFromStart(page, STAFF);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/$/);
});

test('staff cannot see or open user management', async ({ page }) => {
  await signInFromStart(page, STAFF);
  await expect(page.getByText('Signed in as Amara Okafor · Staff')).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);

  await expect(page.getByText('Pick, pack and dispatch shipments')).toBeVisible();
  await expect(page.getByText('Post stock adjustments')).toHaveCount(0);
  await expect(page.getByText('Active accounts by role')).toHaveCount(0);

  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('role-specific dashboard for an inventory manager', async ({ page }) => {
  await signInFromStart(page, INVENTORY);
  await expect(page.getByText('Signed in as Marcus Chen · Inventory Manager')).toBeVisible();
  await expect(page.getByText('Post stock adjustments')).toBeVisible();
  await expect(page.getByText('Approve purchase orders')).toHaveCount(0);
});

test('unknown pages show not found inside the app', async ({ page }) => {
  await signInFromStart(page, ADMIN);
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
