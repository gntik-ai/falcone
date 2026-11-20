import { expect } from '../settled-expect.mjs';

// Port of the login-only helper from the legacy context-auth journey.
export async function loginToConsole(page, copy, username = 'operations') {
  await expect(page.getByRole('heading', { level: 1, name: copy.title, exact: true })).toBeVisible();
  await page.getByLabel(copy.labels.username, { exact: true }).fill(username);
  await page.getByLabel(copy.labels.password, { exact: true }).fill('synthetic-login-password');
  await page.getByRole('button', { name: copy.labels.submit, exact: true }).click();
}
