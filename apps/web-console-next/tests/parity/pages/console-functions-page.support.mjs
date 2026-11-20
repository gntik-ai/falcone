import { createHash } from 'node:crypto';
import { expect } from '../settled-expect.mjs';
import es from '../../../src/locales/es/pages.console-functions-page.json' with { type: 'json' };
import en from '../../../src/locales/en/pages.console-functions-page.json' with { type: 'json' };
import { actionPath, query } from './console-functions-page.manifest.ts';

export const copy = (parity) => (parity.locale === 'es' ? es : en);
export const surface = (parity) => parity.page.getByTestId('console-functions-page');
export const functionCalls = (parity) => parity.network.requests.filter(({ path }) => path.startsWith('/v1/functions'));
export const calls = (parity) => functionCalls(parity).map(({ method, path, body }) => ({ method, path, body }));
export const get = (path) => ({ method: 'GET', path, body: undefined });
export const detailPath = actionPath(1);
export const versionsPath = `${detailPath}/versions${query}`;
export const activationsPath = `${detailPath}/activations${query}`;
export const button = (parity, name) => surface(parity).getByRole('button', { name, exact: true });
export const tab = (parity, key) => surface(parity).getByRole('tab', { name: copy(parity).tabs[key], exact: true });
export const radio = (parity, name) => surface(parity).getByRole('radio', { name, exact: true });
export const ready = async (parity) => expect(surface(parity).getByRole('table', { name: copy(parity).inventory.caption, exact: true })).toBeVisible();
export const pane = (parity) => surface(parity).getByTestId('functions-detail-pane');
// An empty version history renders its empty label instead of the timeline list, so callers that stub it pass { history: false }.
export async function select(parity, name = 'synthetic-hello', { history = true } = {}) {
  await ready(parity);
  await radio(parity, name).check();
  await expect(surface(parity).getByTestId('functions-detail')).toBeVisible();
  if (history) await expect(surface(parity).getByRole('list', { name: copy(parity).history.label, exact: true })).toBeVisible();
  else await expect(surface(parity).getByTestId('functions-detail').getByText(copy(parity).history.empty, { exact: true })).toBeVisible();
}
export async function openTab(parity, key) {
  await tab(parity, key).click();
  await expect(tab(parity, key)).toHaveAttribute('aria-selected', 'true');
}
// Records the Idempotency-Key of every write, since the harness records only method, path and body.
export function trackKeys(parity) {
  const keys = [];
  parity.page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/v1/functions')) keys.push({ method: request.method(), path: new URL(request.url()).pathname, key: request.headers()['idempotency-key'] });
  });
  return keys;
}
export async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
export const failureText = (parity, status) => (status === 500 ? copy(parity).errors['5xx'] : copy(parity).errors[String(status)]);
