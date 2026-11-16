import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { copy } from './console-events-data-page.locale.mjs';
import { consumeResourceDiagnostic } from '../resource-diagnostics.mjs';
export const surface = (parity) => parity.page.getByTestId('console-events-data-page');
export const button = (parity, key) => surface(parity).getByRole('button', { name: copy(parity)[key], exact: true });
export const field = (parity, key) => surface(parity).getByRole('textbox', { name: key === 'messageJson' ? copy(parity)[key].replace('{example}', '{ "value": { ... } }') : copy(parity)[key], exact: true });
export const radio = (parity, topic = 'synthetic-orders') => surface(parity).getByRole('radio', { name: topic, exact: true });
export const eventCalls = (parity) => parity.network.requests.filter(({ path }) => path.startsWith('/v1/events/'));
export const ready = async (parity) => expect(surface(parity).getByRole('table', { name: copy(parity).listLegend, exact: true })).toBeVisible();
export async function screenshot(parity, info, name) {
  const body = await parity.page.screenshot({ fullPage: true, animations: 'disabled' });
  await info.attach(`${name}-${parity.locale}-sha256-${createHash('sha256').update(body).digest('hex')}`, { body, contentType: 'image/png' });
}
export function trackInjectedErrors(parity) {
  const injected = [];
  const scoped = (url) => new URL(url).pathname.startsWith('/v1/events/');
  parity.page.on('response', (response) => { if (scoped(response.url()) && response.status() >= 400) injected.push({ url: response.url(), kind: String(response.status()) }); });
  parity.page.on('requestfailed', (request) => { if (scoped(request.url())) injected.push({ url: request.url(), kind: 'network' }); });
  parity.page.on('console', (message) => {
    if (message.type() !== 'error' || !consumeResourceDiagnostic(message.text(), message.location().url, injected)) return;
    const index = parity.faults.indexOf(`console.error: ${message.text()}`);
    if (index >= 0) parity.faults.splice(index, 1);
  });
}
