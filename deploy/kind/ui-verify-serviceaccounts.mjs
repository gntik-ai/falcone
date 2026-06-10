// Headless-Chromium verification of the Service Accounts page, wired to the
// adapted control-plane SA endpoints (create -> get -> issue credential).
import { chromium } from 'playwright';

const GW = process.env.GW || 'http://192.168.1.132:31908';
const PASS = process.env.SUPERADMIN_PASSWORD;
const TENANT_LABEL = process.env.TENANT_LABEL || 'DataPlane Demo';
const OUT = '/out';
const SA_NAME = `Pipeline ${Date.now().toString(36)}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const log = (m) => console.log(m);

async function waitForWorkspaceContext() {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="console-context-workspace-select"]');
    return el && el.value && el.value.length > 0;
  }, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(800);
}

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

  // Navigate FIRST, then select the workspace while already on the page — the SA
  // page hard-gates on activeWorkspaceId, and selecting after nav avoids the
  // nav-time context reset blanking the selection.
  await page.locator('nav a:has-text("Service Accounts")').first().click();
  await page.waitForTimeout(1500);
  const wsSel = page.locator('[data-testid="console-context-workspace-select"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="console-context-workspace-select"]');
    return el && el.querySelectorAll('option').length > 1;
  }, { timeout: 20000 }).catch(() => null);
  const wsValues = await wsSel.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
  if (wsValues[0]) await wsSel.selectOption(wsValues[0]);
  await page.waitForTimeout(1500);
  const hasError1 = (await page.locator('body').innerText().catch(() => '')).includes('Minified React error');
  log(`SA page loaded; react-error=${hasError1}`);

  // create a service account through the page form
  await page.locator('input[aria-label="Nombre de service account"]').waitFor({ timeout: 20000 });
  await page.locator('input[aria-label="Nombre de service account"]').fill(SA_NAME);
  await Promise.all([
    page.waitForResponse((r) => /\/service-accounts$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null),
    page.locator('button:has-text("Crear")').first().click()
  ]);
  await page.waitForTimeout(3000);
  let body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`AFTER CREATE contains "${SA_NAME}"? ${body.includes(SA_NAME)}`);
  await page.screenshot({ path: `${OUT}/14-service-accounts.png`, fullPage: true });

  // issue a credential (Emitir) -> credential dialog
  const emit = page.locator('button:has-text("Emitir")').first();
  if (await emit.count()) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/credential-issuance') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null),
      emit.click()
    ]);
    await page.waitForTimeout(2000);
    const dialog = await page.locator('[aria-label="Credencial emitida"]').count();
    log(`credential dialog shown? ${dialog > 0}`);
    await page.screenshot({ path: `${OUT}/15-sa-credential.png`, fullPage: true });
  }

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-sa-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
