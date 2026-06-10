// Headless-Chromium verification of the MongoDB page, wired to REAL MongoDB.
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

  await page.locator('nav a:has-text("MongoDB")').first().click();
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
  log(`MONGO react-error=${hasError}`);

  // select database wsdemo
  await page.locator('text=wsdemo').first().click().catch(() => log('no wsdemo row'));
  await page.waitForTimeout(2000);
  let full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`after db select: users=${full.includes('users')} orders=${full.includes('orders')}`);
  await page.screenshot({ path: `${OUT}/18-mongo.png`, fullPage: true });

  // select collection users -> documents tab
  await page.locator('text=users').first().click().catch(() => log('no users row'));
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Documentos")').first().click().catch(() => log('no Documentos tab'));
  await page.waitForTimeout(2500);
  full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`documents view: Alice=${full.includes('Alice')} bob=${full.includes('bob@dp.demo')} email_unique=${full.includes('email_unique')}`);
  await page.screenshot({ path: `${OUT}/19-mongo-documents.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-mongo-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
