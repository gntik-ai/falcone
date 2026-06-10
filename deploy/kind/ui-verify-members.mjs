// Headless-Chromium verification of the Members page (read + inline create),
// wired to the control-plane tenant-realm user endpoints. Official Playwright image.
import { chromium } from 'playwright';

const GW = process.env.GW || 'http://192.168.1.132:31908';
const PASS = process.env.SUPERADMIN_PASSWORD;
const TENANT_LABEL = process.env.TENANT_LABEL || 'DataPlane Demo';
const OUT = '/out';
const NEW_USER = `bob-${Date.now().toString(36)}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const log = (m) => console.log(m);

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

  // select tenant (Members is tenant-realm scoped; no workspace needed)
  const tenantSel = page.locator('[data-testid="console-context-tenant-select"]');
  await tenantSel.waitFor({ timeout: 20000 });
  await tenantSel.selectOption({ label: TENANT_LABEL });
  await page.waitForTimeout(2000);

  // navigate to Members and wait for the users table to settle
  await page.locator('nav a:has-text("Members")').first().click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const t = document.querySelector('table');
    return t && t.querySelectorAll('tbody tr').length > 0;
  }, { timeout: 15000 }).catch(() => null);
  let body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`MEMBERS (read): ${body.slice(0, 240)}`);
  await page.screenshot({ path: `${OUT}/08-members.png`, fullPage: true });

  // open create panel + fill the form
  await page.locator('button:has-text("Crear usuario")').first().click();
  await page.waitForTimeout(800);
  await page.locator('input[placeholder="jdoe"]').fill(NEW_USER);
  await page.locator('input[type="email"]').fill(`${NEW_USER}@dp.demo`);
  await page.locator('input[type="password"]').last().fill('Passw0rd!42');
  // role select defaults to tenant_developer; submit the create form
  const [createResp] = await Promise.all([
    page.waitForResponse((r) => /\/v1\/tenants\/[^/]+\/users$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null),
    page.locator('section[aria-label="Crear usuario en el realm del tenant"] button[type="submit"]').click()
  ]);
  log(`CREATE user ${NEW_USER} -> ${createResp ? createResp.status() : 'no response'}`);
  await page.waitForTimeout(3000);

  // confirm the new user appears in the table
  body = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`MEMBERS (after create) contains ${NEW_USER}? ${body.includes(NEW_USER)}`);
  await page.screenshot({ path: `${OUT}/09-members-after-create.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-members-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
