import { test, expect } from '@playwright/test';
import { registerUser } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('a wrong URL shows the 404 page, signed out, and points at sign in', async ({ page }) => {
  await page.goto('/no-such-page');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page doesn't exist");
  // The path that missed is shown, so the user can see what they actually hit
  await expect(page.getByText('/no-such-page')).toBeVisible();

  // Signed out, "Back to chat" would bounce off the auth guard straight back here
  await expect(page.getByRole('button', { name: 'Back to chat' })).toBeHidden();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a signed-in visitor is offered the way back into the chat', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await page.goto('/conversations/deleted-thread');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page doesn't exist");

  await page.getByRole('button', { name: 'Back to chat' }).click();

  await expect(page).toHaveURL(/localhost:5173\/$/);
  await expect(page.getByPlaceholder('Search users...')).toBeVisible();
});
