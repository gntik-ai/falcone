// Headless-Chromium verification of the PostgreSQL data-browser, wired to REAL pg.
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
  await page.waitForTimeout(2500);

  await page.locator('nav a[href="/console/postgres"]').first().click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="console-context-workspace-select"]');
    return el && el.querySelectorAll('option').length > 1;
  }, { timeout: 20000 }).catch(() => null);
  const wsSel = page.locator('[data-testid="console-context-workspace-select"]');
  const wsValues = await wsSel.locator('option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  if (wsValues[0]) await wsSel.selectOption(wsValues[0]);
  await page.waitForTimeout(3000);

  const hasError = (await page.locator('body').innerText().catch(() => '')).includes('Minified React error');
  log(`POSTGRES react-error=${hasError}`);

  // drill: database in_falcone -> schema public -> table
  await page.locator('text=in_falcone').first().click().catch(() => log('no in_falcone'));
  await page.waitForTimeout(2000);
  let full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`after db: public=${full.includes('public')}`);
  await page.locator('text=public').first().click().catch(() => log('no public'));
  await page.waitForTimeout(2000);
  full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`after schema: async_operations=${full.includes('async_operations')}`);
  await page.screenshot({ path: `${OUT}/20-postgres.png`, fullPage: true });

  await page.locator('text=async_operations').first().click().catch(() => log('no table'));
  await page.waitForTimeout(2500);
  full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`after table: operation_id=${full.includes('operation_id')} tenant_id=${full.includes('tenant_id')}`);
  await page.screenshot({ path: `${OUT}/21-postgres-table.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-pg-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
