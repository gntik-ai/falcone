import { test, expect } from './harness.mjs';
import manifest, { canary, secretsPath } from './pages/console-workspace-secrets-page.manifest.ts';
import { createSecretsHarness, expectBlank, typeSecret } from './pages/console-workspace-secrets-page.support.mjs';

// Every test here fails on purpose after its value-bearing writes, so the runner persists everything it would
// persist for a real failure. verify-artifacts.mjs then scans that output for the synthetic value.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
test.use({ role: 'superadmin', locale: 'es', pageEndpoints: manifest.endpoints, trace: 'off', screenshot: 'off', video: 'off' });
const harnesses = new WeakMap();
test.beforeEach(async ({ parity }) => { harnesses.set(parity, createSecretsHarness(parity)); });
const field = (parity, label) => parity.page.getByTestId('workspace-secrets-create').getByLabel(label, { exact: true });

test('probe: failed, retried and aborted POST writes leave no value in any artifact', async ({ parity }, info) => {
  const probe = harnesses.get(parity);
  probe.use('workspace-secrets.create.500-then-network-then-success');
  await parity.open(manifest.route);
  await field(parity, 'Nombre del secreto').fill('probe_secret');
  await typeSecret(field(parity, 'Valor del secreto'), canary);
  await parity.page.getByRole('button', { name: 'Crear secreto', exact: true }).click();
  // 500, then a retry that is aborted by the network, leaving the value in the form.
  await expect(parity.page.getByTestId('workspace-secrets-failure-create')).toBeVisible();
  await parity.page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(parity.page.getByText('No se pudo contactar con el servicio. Comprueba la conexión y reintenta.')).toBeVisible();
  expect(probe.writes().length).toBe(2);
  expect(probe.state.matched.every(Boolean)).toBe(true);
  await info.attach('redacted-requests', { body: JSON.stringify(probe.writes()), contentType: 'application/json' });
  await info.attach('form-element', { body: await parity.page.getByTestId('workspace-secrets-create').screenshot({ mask: [parity.page.locator('input')] }), contentType: 'image/png' });
  // Forced failure with a failing clear: the message names the field, never the value.
  await expectBlank(expect, field(parity, 'Valor del secreto'), 'value');
});

test('probe: failed, retried and aborted PUT writes leave no value in any artifact', async ({ parity }, info) => {
  const probe = harnesses.get(parity);
  probe.use('workspace-secrets.replace.500-then-network-then-success');
  await parity.open(manifest.route);
  await parity.page.getByRole('button', { name: 'Reemplazar el secreto db_password', exact: true }).click();
  const dialog = parity.page.getByRole('dialog', { name: 'Reemplazar secreto', exact: true });
  await typeSecret(dialog.getByLabel('Nuevo valor del secreto', { exact: true }), canary);
  await dialog.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  const confirm = parity.page.getByRole('alertdialog');
  await confirm.getByLabel('Escribe exactamente el nombre del recurso para confirmar.', { exact: true }).fill('db_password');
  await confirm.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await expect(confirm.getByTestId('workspace-secrets-failure-confirm')).toBeVisible();
  await confirm.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(confirm.getByText('No se pudo contactar con el servicio. Comprueba la conexión y reintenta.')).toBeVisible();
  expect(probe.writes().map(({ method, path }) => `${method} ${path}`)).toEqual([`PUT ${secretsPath}/db_password`, `PUT ${secretsPath}/db_password`]);
  expect(probe.state.matched.every(Boolean)).toBe(true);
  await info.attach('redacted-requests', { body: JSON.stringify(probe.writes()), contentType: 'application/json' });
  // Forced failure while the value is still open in the confirmation's dialog state.
  expect(await parity.page.evaluate(() => document.body.innerText.length), 'forced probe failure').toBe(-1);
});
