import { test, expect } from '@playwright/test';
import { registerUser, loginUser, createDirectConversation } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('a contact turns Online when they log in and Offline when they leave, live', async ({
  browser,
  request,
}) => {
  const watcher = await registerUser(request);
  const contact = await registerUser(request);

  const watcherToken = await loginUser(request, watcher.username, watcher.password);
  await createDirectConversation(request, watcherToken, watcher.id, contact.id);

  const watcherCtx = await browser.newContext();
  const contactCtx = await browser.newContext();
  const watcherPage = await watcherCtx.newPage();

  try {
    await loginViaUI(watcherPage, watcher.username, watcher.password);

    // Scoped to the contact's sidebar row: the watcher's own profile header
    // also shows "Online", and the conversation stays closed so there is no
    // chat header in play either
    const status = watcherPage.getByRole('button', { name: new RegExp(contact.username) });
    await expect(status).toContainText('Offline');

    const contactPage = await contactCtx.newPage();
    await loginViaUI(contactPage, contact.username, contact.password);

    // No reload on the watcher's side
    await expect(status).toContainText('Online');

    // Closing the tab drops the WebSocket, which is what reports them offline
    await contactPage.close();
    await expect(status).toContainText('Offline');
  } finally {
    await watcherCtx.close();
    await contactCtx.close();
  }
});

test('a second tab keeps you online when the first one closes', async ({ browser, request }) => {
  const watcher = await registerUser(request);
  const contact = await registerUser(request);

  const watcherToken = await loginUser(request, watcher.username, watcher.password);
  await createDirectConversation(request, watcherToken, watcher.id, contact.id);

  const watcherCtx = await browser.newContext();
  const contactCtx = await browser.newContext();
  const watcherPage = await watcherCtx.newPage();

  try {
    await loginViaUI(watcherPage, watcher.username, watcher.password);
    const status = watcherPage.getByRole('button', { name: new RegExp(contact.username) });

    const firstTab = await contactCtx.newPage();
    await loginViaUI(firstTab, contact.username, contact.password);
    await expect(status).toContainText('Online');

    // Same browser context, so the session is shared — a genuine second tab
    const secondTab = await contactCtx.newPage();
    await secondTab.goto('/');
    await expect(secondTab.getByPlaceholder('Search users...')).toBeVisible();

    await firstTab.close();

    // One connection left, so they must *stay* online. Assert after a pause —
    // an immediate assertion would pass simply because the flip hasn't landed
    await watcherPage.waitForTimeout(1500);
    await expect(status).toContainText('Online');

    await secondTab.close();
    await expect(status).toContainText('Offline');
  } finally {
    await watcherCtx.close();
    await contactCtx.close();
  }
});
