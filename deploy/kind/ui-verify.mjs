// Headless browser verification of the Falcone console against the deployed
// gateway, using the OFFICIAL Playwright Docker image (Chromium + deps bundled,
// independent of the host OS — the fix for "Playwright does not support chromium
// on ubuntu26.04"). Run with:
//   docker run --rm --network host -e GW -e SUPERADMIN_PASSWORD \
//     -v "$PWD/deploy/kind/ui-verify.mjs:/ui.mjs" -v "$PWD/deploy/kind/.uiout:/out" \
//     mcr.microsoft.com/playwright:v1.50.0-noble node /ui.mjs
import { chromium } from 'playwright';

const GW = process.env.GW || 'http://192.168.1.132:31908';
const PASS = process.env.SUPERADMIN_PASSWORD;
const OUT = '/out';

const browser = await chromium.launch();
const page = await browser.newPage();
const steps = [];
const log = (m) => { steps.push(m); console.log(m); };

try {
  // 1) Console SPA loads at the gateway origin.
  await page.goto(`${GW}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  const title = await page.title();
  log(`1) SPA loaded at ${GW}/login — title="${title}"`);
  await page.screenshot({ path: `${OUT}/01-login.png` });

  // 2) Log in through the real UI form (username/password -> /v1/auth/login-sessions).
  // The console renders a username + password field + submit.
  await page.getByLabel(/usuario|username/i).first().fill('superadmin').catch(async () => {
    await page.locator('input[type="text"], input[name*="user" i]').first().fill('superadmin');
  });
  await page.locator('input[type="password"]').first().fill(PASS);
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/auth/login-sessions') && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null),
    page.locator('button[type="submit"], button:has-text("Entrar")').first().click()
  ]);
  log(`2) submitted login — /v1/auth/login-sessions -> ${loginResp ? loginResp.status() : 'no response captured'}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/02-after-login.png`, fullPage: true });

  // 3) Navigate to the Tenants admin page and confirm it renders data.
  await page.goto(`${GW}/console/tenants`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const url = page.url();
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);
  log(`3) /console/tenants — url=${url}`);
  log(`   body excerpt: ${bodyText.replace(/\s+/g, ' ').slice(0, 200)}`);
  await page.screenshot({ path: `${OUT}/03-tenants.png`, fullPage: true });

  log('DONE');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: `${OUT}/99-error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
