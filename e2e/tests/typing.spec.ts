import { test, expect } from '@playwright/test';
import { registerUser, loginUser, createDirectConversation } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('the other user sees a typing indicator while you type, and it clears when you stop', async ({
  browser,
  request,
}) => {
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

    await pageA.getByText(userB.username, { exact: true }).click();
    await pageB.getByText(userA.username, { exact: true }).click();

    const inputA = pageA.getByPlaceholder('Type a message...');
    await expect(inputA).toBeVisible();

    // A direct chat renders the label twice — the header subtitle and the bubble
    const typingOnB = pageB.getByText('typing...').first();
    await expect(typingOnB).toBeHidden();

    await inputA.fill('drafting something');
    await expect(typingOnB).toBeVisible();

    // The avatar next to the indicator is labelled with who is typing
    await expect(pageB.getByTitle(userA.username)).toBeVisible();

    // Pinned to the bottom of the chat frame: it sits directly above the composer
    // even in a near-empty conversation, rather than trailing the last message
    const indicatorBox = await pageB.locator('[aria-live="polite"]').boundingBox();
    const composerBox = await pageB.getByPlaceholder('Type a message...').boundingBox();
    expect(indicatorBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    const gap = composerBox!.y - (indicatorBox!.y + indicatorBox!.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(60);

    // A never sees their own typing echoed back
    await expect(pageA.getByText('typing...')).toHaveCount(0);

    // Emptying the box retracts it without waiting for the idle timeout
    await inputA.fill('');
    await expect(typingOnB).toBeHidden();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('the typing indicator clears once the message is actually sent', async ({ browser, request }) => {
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

    await pageA.getByText(userB.username, { exact: true }).click();
    await pageB.getByText(userA.username, { exact: true }).click();

    const inputA = pageA.getByPlaceholder('Type a message...');
    const messageText = `typing then sending ${Date.now()}`;

    await inputA.fill(messageText);
    await expect(pageB.getByText('typing...').first()).toBeVisible();

    await inputA.press('Enter');

    await expect(pageB.getByText(messageText)).toBeVisible();
    await expect(pageB.getByText('typing...')).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
