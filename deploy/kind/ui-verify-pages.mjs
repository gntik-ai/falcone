// Headless-Chromium verification of the NEW console pages (Database / Functions
// Registry / IAM Access) wired to the control-plane. Run via the official
// Playwright image (see README "Chromium / Playwright"). Drives the real shell:
// login -> select tenant+workspace -> visit each new page.
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
  await page.waitForTimeout(1500);
}

// The shell refetches tenant/workspace context on every route change (it hands
// the provider a fresh session object), briefly resetting the selection before
// restoring it from localStorage. Wait for it to settle before asserting.
async function waitForWorkspaceContext() {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="console-context-workspace-select"]');
    return el && el.value && el.value.length > 0;
  }, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(800);
}

try {
  // 1) login
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

  // 2) select tenant -> workspace via the shell context controls
  const tenantSel = page.locator('[data-testid="console-context-tenant-select"]');
  await tenantSel.waitFor({ timeout: 20000 });
  const tenantOptions = await tenantSel.locator('option').allInnerTexts();
  log(`tenant options: ${JSON.stringify(tenantOptions)}`);
  await tenantSel.selectOption({ label: TENANT_LABEL });
  await page.waitForTimeout(2500);
  const wsSel = page.locator('[data-testid="console-context-workspace-select"]');
  // wait until a real workspace option (not just the placeholder) appears
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="console-context-workspace-select"]');
    return el && el.querySelectorAll('option').length > 1;
  }, { timeout: 20000 }).catch(() => null);
  const wsOptions = await wsSel.locator('option').allInnerTexts();
  log(`workspace options: ${JSON.stringify(wsOptions)}`);
  const wsValues = await wsSel.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
  if (wsValues[0]) await wsSel.selectOption(wsValues[0]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-context.png` });

  // 3) Workspace Database page
  await clickNav('Workspace DB');
  await waitForWorkspaceContext();
  let bodyText = (await page.locator('main[data-testid="console-workspace-database-page"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  // provision if not yet provisioned
  const provisionBtn = page.locator('button:has-text("Aprovisionar base de datos")');
  if (await provisionBtn.count()) {
    await provisionBtn.first().click();
    await page.waitForTimeout(4000);
    bodyText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ');
  }
  log(`DATABASE page: ${bodyText.slice(0, 220)}`);
  await page.screenshot({ path: `${OUT}/05-database.png`, fullPage: true });

  // 4) Functions Registry page
  await clickNav('Functions (Registry)');
  await waitForWorkspaceContext();
  bodyText = (await page.locator('main[data-testid="console-function-registry-page"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`FUNCTIONS page: ${bodyText.slice(0, 220)}`);
  await page.screenshot({ path: `${OUT}/06-functions.png`, fullPage: true });

  // 5) IAM Access page -> select first user
  await clickNav('IAM Access');
  await page.waitForTimeout(2000);
  const firstUser = page.locator('[data-testid="console-iam-access-page"] ul button').first();
  if (await firstUser.count()) {
    await firstUser.click();
    await page.waitForTimeout(2000);
  }
  bodyText = (await page.locator('main[data-testid="console-iam-access-page"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  log(`IAM page: ${bodyText.slice(0, 260)}`);
  await page.screenshot({ path: `${OUT}/07-iam.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-pages-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
