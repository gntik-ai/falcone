// Headless-Chromium verification of the Storage page, wired to REAL SeaweedFS/S3.
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

  // navigate, then select workspace on-page
  await page.locator('nav a:has-text("Storage")').first().click();
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
  let body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`STORAGE react-error=${hasError}`);
  log(`STORAGE: ${body.slice(0, 260)}`);
  await page.screenshot({ path: `${OUT}/16-storage.png`, fullPage: true });

  // click the bucket button to load its objects
  const bucketCell = page.locator('button:has-text("ws-primary-assets")').first();
  if (await bucketCell.count()) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/objects') && r.request().method() === 'GET', { timeout: 20000 }).catch(() => null),
      bucketCell.click()
    ]);
    await page.waitForTimeout(2500);
    const full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    log(`objects visible: readme.txt=${full.includes('readme.txt')} config/app.json=${full.includes('config/app.json')} images/logo.bin=${full.includes('images/logo.bin')}`);
    await page.screenshot({ path: `${OUT}/17-storage-objects.png`, fullPage: true });
  }

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-storage-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
