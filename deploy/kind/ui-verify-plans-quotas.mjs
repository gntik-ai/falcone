// Headless-Chromium verification of the Plans catalog + Quotas posture pages,
// wired to the real domain-A plan/quota endpoints (auth) + synthesized metrics.
import { chromium } from 'playwright';

const GW = process.env.GW || 'http://192.168.1.132:31908';
const PASS = process.env.SUPERADMIN_PASSWORD;
const TENANT_LABEL = process.env.TENANT_LABEL || 'DataPlane Demo';
const OUT = '/out';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const log = (m) => console.log(m);

async function clickNav(label) {
  await page.locator(`nav a:has-text("${label}")`).first().click();
  await page.waitForTimeout(2000);
}

try {
  // login
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

  // select tenant + workspace
  const tenantSel = page.locator('[data-testid="console-context-tenant-select"]');
  await tenantSel.waitFor({ timeout: 20000 });
  await tenantSel.selectOption({ label: TENANT_LABEL });
  await page.waitForTimeout(2500);
  const wsSel = page.locator('[data-testid="console-context-workspace-select"]');
  const wsValues = await wsSel.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
  if (wsValues[0]) await wsSel.selectOption(wsValues[0]);
  await page.waitForTimeout(1500);

  // Plans catalog
  await clickNav('Plans');
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return rows.length > 0;
  }, { timeout: 15000 }).catch(() => null);
  const planRows = await page.locator('table tbody tr').count();
  let body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`PLANS catalog: rows=${planRows} | ${body.slice(0, 160)}`);
  await page.screenshot({ path: `${OUT}/10-plans.png`, fullPage: true });

  // Plan detail (best-effort — click first plan row)
  if (planRows > 0) {
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(2500);
    body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
    log(`PLAN detail: ${body.slice(0, 160)}`);
    await page.screenshot({ path: `${OUT}/11-plan-detail.png`, fullPage: true });
  }

  // Quotas posture
  await clickNav('Quotas');
  await page.waitForTimeout(2500);
  body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`QUOTAS: ${body.slice(0, 220)}`);
  await page.screenshot({ path: `${OUT}/12-quotas.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-pq-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
