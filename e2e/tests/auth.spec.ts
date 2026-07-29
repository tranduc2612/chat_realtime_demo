import { test, expect } from '@playwright/test';
import { uniqueUsername } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('register, log out, log back in, and reject wrong credentials', async ({ page }) => {
  const username = uniqueUsername();
  const email = `${username}@example.com`;
  const password = 'TestPass123!';

  // --- Register via the real form ---
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Registration auto-logs-in and redirects to the chat page.
  await page.waitForURL('**/');
  await expect(page.getByText('Your messages')).toBeVisible();

  // --- Log out ---
  await page.getByTitle('Sign out').click();
  await page.waitForURL('**/login');

  // --- Log back in ---
  await loginViaUI(page, username, password);
  await expect(page.getByText('Your messages')).toBeVisible();
  await page.getByTitle('Sign out').click();
  await page.waitForURL('**/login');

  // --- Wrong password stays on /login with an error ---
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid username or password')).toBeVisible();
  expect(page.url()).toContain('/login');
});
