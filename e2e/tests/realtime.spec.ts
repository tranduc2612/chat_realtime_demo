import { test, expect } from '@playwright/test';
import { registerUser, loginUser, createDirectConversation } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('a message sent by one user appears live for the other, with no reload', async ({ browser, request }) => {
  const userA = await registerUser(request);
  const userB = await registerUser(request);

  const tokenA = await loginUser(request, userA.username, userA.password);
  await createDirectConversation(request, tokenA, userA.id, userB.id);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await loginViaUI(pageA, userA.username, userA.password);
    await loginViaUI(pageB, userB.username, userB.password);

    // Both users already have the conversation (created before login) in their sidebar.
    await pageA.getByText(userB.username, { exact: true }).click();
    await pageB.getByText(userA.username, { exact: true }).click();

    const messageText = `realtime ping ${Date.now()}`;
    const input = pageA.getByPlaceholder('Type a message...');
    await expect(input).toBeVisible();
    await input.fill(messageText);
    await input.press('Enter');

    // No reload on pageB — this proves the Redis pub/sub + WebSocket room broadcast works.
    await expect(pageB.getByText(messageText)).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
