import { test, expect } from '@playwright/test';
import { registerUser } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('start a direct conversation and send a message that survives a reload', async ({ page, request }) => {
  const userA = await registerUser(request);
  const userB = await registerUser(request);

  await loginViaUI(page, userA.username, userA.password);

  // Start a direct conversation with user B via the search dropdown.
  await page.getByPlaceholder('Search users...').fill(userB.username);
  const result = page.getByText(userB.username, { exact: true });
  await expect(result).toBeVisible();
  await result.click();

  // The conversation should now be active — MessageInput only renders once one is.
  const messageText = `hello from messaging test ${Date.now()}`;
  const input = page.getByPlaceholder('Type a message...');
  await expect(input).toBeVisible();
  await input.fill(messageText);
  await input.press('Enter');

  await expect(page.getByText(messageText)).toBeVisible();

  // Reload — chatStore (unlike authStore) isn't persisted, so no conversation is active
  // after a refresh. Reselect it, then the message must come back from history (a real
  // GET /messages/{id} fetch), not just the local WS-echoed state from before the reload.
  await page.reload();
  await page.getByText(userB.username, { exact: true }).click();
  await expect(page.getByText(messageText)).toBeVisible();
});
