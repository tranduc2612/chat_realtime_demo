import { test, expect } from '@playwright/test';
import { registerUser } from '../helpers/users';
import { loginViaUI } from '../helpers/ui';

// Smallest valid PNG: a 1x1 image, real header and all — the API sniffs magic
// bytes, so a fake buffer with a .png name would (correctly) be rejected.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function openProfile(page: import('@playwright/test').Page) {
  await page.getByTitle('Edit your profile').click();
  await expect(page.getByRole('dialog', { name: 'Edit profile' })).toBeVisible();
}

test('update the display name and see it in the sidebar, surviving a reload', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);
  const newName = `Renamed ${Date.now()}`;
  await page.getByLabel('Full Name').fill(newName);
  await page.getByRole('button', { name: 'Save Changes' }).click();

  // Saving closes the dialog itself and confirms with a toast.
  await expect(page.getByText('Profile updated successfully')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Edit profile' })).toBeHidden();
  await expect(page.getByText(newName)).toBeVisible();

  // The store persists to localStorage, so a reload alone proves little —
  // what matters is that GET /users/me returns the new name from MySQL.
  await page.reload();
  await expect(page.getByText(newName)).toBeVisible();
});

test('upload an avatar and have it served back by the API', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);
  await page.getByTestId('avatar-input').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.getByText(/New photo selected/)).toBeVisible();

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Profile updated successfully')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Edit profile' })).toBeHidden();

  // The sidebar avatar must now point at /uploads/... on the API origin, and
  // that URL must actually serve the bytes — the file was written by one of
  // three replicas and is being read back through nginx by (usually) another.
  const src = await page.locator('aside img').first().getAttribute('src');
  expect(src).toContain('/uploads/avatars/');

  const fetched = await request.get(src!);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()['content-type']).toContain('image/png');
});

test('rejects a non-image file', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);
  await page.getByTestId('avatar-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('definitely not an image'),
  });

  await expect(page.getByText(/Only JPEG, PNG, GIF and WebP/)).toBeVisible();
});

test('rejects a script renamed as a .png — the server checks the bytes', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);
  // Content-type and filename both claim PNG, so the browser-side check
  // passes and the request really reaches the API. Only the magic-byte sniff
  // on the server can catch this one.
  await page.getByTestId('avatar-input').setInputFiles({
    name: 'pwn.png',
    mimeType: 'image/png',
    buffer: Buffer.from("<?php system($_GET['c']); ?>"),
  });
  await expect(page.getByText(/New photo selected/)).toBeVisible();

  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page.getByText('That file is not a valid image')).toBeVisible();
});

test('rejects a password change with the wrong current password', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByLabel('Current password').fill('WrongPass123!');
  await page.getByLabel('New password', { exact: true }).fill('BrandNewPass1!');
  await page.getByLabel('Confirm new password').fill('BrandNewPass1!');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect(page.getByText('Current password is incorrect')).toBeVisible();
});

test('changing the password lets you log in with the new one', async ({ page, request }) => {
  const user = await registerUser(request);
  const newPassword = 'BrandNewPass1!';
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByLabel('Current password').fill(user.password);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Profile updated successfully')).toBeVisible();

  // The old token stays valid (it's signed, not stored), so the only real
  // proof is a fresh login with the new password.
  await page.getByTitle('Sign out').click();
  await loginViaUI(page, user.username, newPassword);

  await expect(page.getByPlaceholder('Search users...')).toBeVisible();
});

test('the username is shown but cannot be edited — it is the login identifier', async ({ page, request }) => {
  const user = await registerUser(request);
  await loginViaUI(page, user.username, user.password);

  await openProfile(page);

  await expect(page.getByText(`@${user.username}`)).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveCount(0);
});
