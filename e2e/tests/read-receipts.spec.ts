import { test, expect } from '@playwright/test';
import { registerUser, loginUser, createDirectConversation } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('a direct message is marked Seen once the recipient opens the conversation', async ({
  browser,
  request,
}) => {
  const sender = await registerUser(request);
  const recipient = await registerUser(request);

  const senderToken = await loginUser(request, sender.username, sender.password);
  await createDirectConversation(request, senderToken, sender.id, recipient.id);

  const senderCtx = await browser.newContext();
  const recipientCtx = await browser.newContext();
  const senderPage = await senderCtx.newPage();
  const recipientPage = await recipientCtx.newPage();

  try {
    await loginViaUI(senderPage, sender.username, sender.password);
    await senderPage.getByText(recipient.username, { exact: true }).click();

    const messageText = `seen me ${Date.now()}`;
    const input = senderPage.getByPlaceholder('Type a message...');
    await input.fill(messageText);
    await input.press('Enter');
    await expect(senderPage.getByText(messageText)).toBeVisible();

    // Nobody has opened it yet
    await expect(senderPage.getByText('Seen', { exact: true })).toBeHidden();

    // The recipient opens the conversation — no reload on the sender's side
    await loginViaUI(recipientPage, recipient.username, recipient.password);
    await recipientPage.getByText(sender.username, { exact: true }).click();
    await expect(recipientPage.getByText(messageText)).toBeVisible();

    await expect(senderPage.getByText('Seen', { exact: true })).toBeVisible();
    await expect(senderPage.getByTitle(`Seen by ${recipient.username}`)).toBeVisible();
  } finally {
    await senderCtx.close();
    await recipientCtx.close();
  }
});

test('a group message shows which members have seen it', async ({ browser, request }) => {
  const creator = await registerUser(request);
  const memberA = await registerUser(request);
  const memberB = await registerUser(request);

  const creatorCtx = await browser.newContext();
  const readerCtx = await browser.newContext();
  const creatorPage = await creatorCtx.newPage();
  const readerPage = await readerCtx.newPage();

  try {
    await loginViaUI(creatorPage, creator.username, creator.password);

    const groupName = `Crew ${Date.now()}`;
    await creatorPage.getByTitle('New group').click();
    await creatorPage.getByPlaceholder('e.g. Team Alpha, Friends').fill(groupName);
    const memberSearch = creatorPage.getByPlaceholder('Search users to add...');
    await memberSearch.fill(memberA.username);
    await creatorPage.getByText(memberA.username, { exact: true }).click();
    await memberSearch.fill(memberB.username);
    await creatorPage.getByText(memberB.username, { exact: true }).click();
    await creatorPage.getByRole('button', { name: 'Create Group' }).click();
    await expect(creatorPage.getByRole('heading', { name: 'New Group' })).toBeHidden();

    const messageText = `who saw this ${Date.now()}`;
    const input = creatorPage.getByPlaceholder('Type a message...');
    await input.fill(messageText);
    await input.press('Enter');
    await expect(creatorPage.getByText(messageText)).toBeVisible();

    // Groups identify readers by avatar, not the word "Seen"
    await expect(creatorPage.getByText('Seen', { exact: true })).toBeHidden();

    // Only memberA reads it
    await loginViaUI(readerPage, memberA.username, memberA.password);
    await readerPage.getByText(groupName, { exact: true }).first().click();
    await expect(readerPage.getByText(messageText)).toBeVisible();

    await expect(creatorPage.getByTitle(`Seen by ${memberA.username}`)).toBeVisible();
    // memberB never opened it, so they must not appear as a reader
    await expect(creatorPage.getByTitle(new RegExp(memberB.username))).toHaveCount(0);
  } finally {
    await creatorCtx.close();
    await readerCtx.close();
  }
});
