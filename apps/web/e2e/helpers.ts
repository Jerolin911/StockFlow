import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD } from '../playwright.config';

export const ADMIN = 'admin@stockflow.test';
export const STAFF = 'staff@stockflow.test';
export const INVENTORY = 'inventory@stockflow.test';

export async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInFromStart(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/login');
  await signIn(page, email, password);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}${Math.floor(Math.random() * 1000)}@stockflow.test`;
}
