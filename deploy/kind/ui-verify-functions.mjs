// Headless-Chromium verification of the Functions page — REAL execution via k8s Jobs.
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

  // navigate to the repo Functions page (not my /console/functions-registry)
  await page.locator('nav a[href="/console/functions"]').first().click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="console-context-workspace-select"]');
    return el && el.querySelectorAll('option').length > 1;
  }, { timeout: 20000 }).catch(() => null);
  const wsSel = page.locator('[data-testid="console-context-workspace-select"]');
  const wsValues = await wsSel.locator('option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  if (wsValues[0]) await wsSel.selectOption(wsValues[0]);
  await page.waitForTimeout(3500);

  const hasError = (await page.locator('body').innerText().catch(() => '')).includes('Minified React error');
  let full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  log(`FUNCTIONS react-error=${hasError} | adder in inventory=${full.includes('adder')}`);
  await page.screenshot({ path: `${OUT}/26-functions.png`, fullPage: true });

  // open the action + trigger a real invocation from the UI if a button is present
  await page.locator('text=multiplier').first().click().catch(() => log('no adder row'));
  await page.waitForTimeout(2000);
  const invokeBtn = page.locator('button:has-text("Invocar"), button:has-text("Invoke"), button:has-text("Ejecutar")').first();
  if (await invokeBtn.count()) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/invocations') && r.request().method() === 'POST', { timeout: 60000 }).catch(() => null),
      invokeBtn.click()
    ]);
    await page.waitForTimeout(6000);
    full = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    log(`after invoke: greeting=${full.includes('hello')} sum=${full.includes('5')}`);
  }
  await page.screenshot({ path: `${OUT}/27-functions-invoke.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-fn-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
