// Headless-Chromium verification of the Observability page, wired to the
// synthesized metrics family (overview+dimensions / usage / series / audit).
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

  const tenantSel = page.locator('[data-testid="console-context-tenant-select"]');
  await tenantSel.waitFor({ timeout: 20000 });
  await tenantSel.selectOption({ label: TENANT_LABEL });
  await page.waitForTimeout(2500);
  const wsSel = page.locator('[data-testid="console-context-workspace-select"]');
  const wsValues = await wsSel.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
  if (wsValues[0]) await wsSel.selectOption(wsValues[0]);
  await page.waitForTimeout(1500);

  await page.locator('nav a:has-text("Observability")').first().click();
  await page.waitForTimeout(3500);
  const body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const hasError = body.includes('Unexpected Application Error') || body.includes('Minified React error');
  log(`OBSERVABILITY error? ${hasError}`);
  log(`OBSERVABILITY: ${body.slice(0, 300)}`);
  await page.screenshot({ path: `${OUT}/13-observability.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-obs-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
