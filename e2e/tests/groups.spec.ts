import { test, expect } from '@playwright/test';
import { registerUser } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

test('create a group, send a message, then add another member', async ({ page, request }) => {
  const creator = await registerUser(request);
  const memberA = await registerUser(request);
  const memberB = await registerUser(request);
  const memberC = await registerUser(request);

  const groupName = `Test Group ${Date.now()}`;

  await loginViaUI(page, creator.username, creator.password);

  // --- Create the group ---
  await page.getByTitle('New group').click();
  await page.getByPlaceholder('e.g. Team Alpha, Friends').fill(groupName);

  const memberSearch = page.getByPlaceholder('Search users to add...');
  await memberSearch.fill(memberA.username);
  await page.getByText(memberA.username, { exact: true }).click();
  await memberSearch.fill(memberB.username);
  await page.getByText(memberB.username, { exact: true }).click();

  await page.getByRole('button', { name: 'Create Group' }).click();

  // Modal closes and the new group becomes active — the name appears both in the
  // sidebar row and the ChatWindow header, so scope to just the first match.
  await expect(page.getByRole('heading', { name: 'New Group' })).toBeHidden();
  await expect(page.getByText(groupName, { exact: true }).first()).toBeVisible();

  // --- Send a message in the group ---
  const messageText = `hello group ${Date.now()}`;
  const input = page.getByPlaceholder('Type a message...');
  await input.fill(messageText);
  await input.press('Enter');
  await expect(page.getByText(messageText)).toBeVisible();

  // --- Add a new member ---
  await page.getByTitle('Add members').click();
  await page.getByPlaceholder('Search users to add...').fill(memberC.username);
  await page.getByText(memberC.username, { exact: true }).click();
  await page.getByRole('button', { name: 'Add Members' }).click();

  await expect(page.getByText('Members added successfully!')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add Members' })).toBeHidden();
});
