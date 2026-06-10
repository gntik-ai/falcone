// Headless-Chromium verification of the Operations page, wired to async_operations.
import { chromium } from 'playwright';

const GW = process.env.GW || 'http://192.168.1.132:31908';
const PASS = process.env.SUPERADMIN_PASSWORD;
const TENANT_LABEL = process.env.TENANT_LABEL || 'DataPlane Demo';
const OUT = '/out';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const log = (m) => console.log(m);

try {
  await page.goto(`${GW}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByLabel(/usuario|username/i).first().fill('superadmin').catch(async () => {
    await page.locator('input[type="text"], input[name*="user" i]').first().fill('superadmin');
  });
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/auth/login-sessions') && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null),
    page.locator('button[type="submit"], button:has-text("Entrar")').first().click()
  ]);
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="console-context-tenant-select"]').selectOption({ label: TENANT_LABEL });
  await page.waitForTimeout(2000);

  await page.locator('nav a[href="/console/operations"]').first().click();
  await page.waitForTimeout(3000);
  const hasError = (await page.locator('body').innerText().catch(() => '')).includes('Minified React error');
  let full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`OPERATIONS react-error=${hasError} | tenant.create=${full.includes('tenant.create')} provision=${full.includes('workspace.database.provision')} failed=${full.includes('failed') || full.includes('Failed') || full.includes('Fallida')}`);
  await page.screenshot({ path: `${OUT}/24-operations.png`, fullPage: true });

  // open an operation detail
  await page.locator('text=tenant.create').first().click().catch(() => log('no op row'));
  await page.waitForTimeout(2500);
  full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`detail url=${page.url()}`);
  await page.screenshot({ path: `${OUT}/25-operation-detail.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-ops-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
