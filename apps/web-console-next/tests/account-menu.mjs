// The account menu is the user menu of the ConsoleShell sidebar footer. Its accessible name comes from the kit
// ("Account menu for <name>"), and below lg the footer lives in the navigation drawer.
export async function openAccountMenu(page, locale) {
  const trigger = page.getByRole('button', { name: locale === 'es' ? /^Menú de la cuenta de / : /^Account menu for / });
  if (!(await trigger.isVisible())) await page.getByRole('button', { name: locale === 'es' ? 'Abrir navegación' : 'Open navigation', exact: true }).click();
  await trigger.click();
}
