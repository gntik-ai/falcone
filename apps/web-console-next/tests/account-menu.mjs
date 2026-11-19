import { expect } from './parity/sample-data-guard.mjs';
// The account menu is the user menu of the ConsoleShell sidebar footer. Its accessible name comes from the kit
// ("Account menu for <name>"), and below lg the footer lives in the navigation drawer.
export async function openAccountMenu(page, locale) {
  const trigger = page.getByRole('button', { name: locale === 'es' ? /^Menú de la cuenta de / : /^Account menu for / });
  if (!(await trigger.isVisible())) await page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
  await trigger.click();
}

// Below lg the account menu is opened from the navigation drawer, a modal dialog that keeps the page behind it out of
// the accessibility tree. Close it before asserting on the page (headings, main landmark) after a menu action.
export async function closeNavigationDrawer(page) {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
