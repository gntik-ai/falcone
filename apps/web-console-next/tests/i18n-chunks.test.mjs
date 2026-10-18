import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const dist = resolve(new URL('../dist', import.meta.url).pathname);
test('route namespaces are lazy local chunks outside the static entry graph', () => {
  const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
  const entry = manifest['index.html'];
  assert.ok(entry?.isEntry);
  const eager = new Set();
  function visit(key) {
    if (eager.has(key)) return;
    eager.add(key);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  visit('index.html');
  const eagerCode = [...eager].map((key) => readFileSync(resolve(dist, manifest[key].file), 'utf8')).join('\n');
  for (const [namespace, spanish, english] of [
    ['welcome', 'Bienvenida', 'Welcome'], ['login', 'Acceso', 'Sign in'],
    ['recovery', 'Recuperar contraseña', 'Recover password'], ['invitation', 'Aceptar invitación', 'Accept invitation'],
    ['signup', 'Solicitar acceso', 'Request access'], ['pendingActivation', 'Registro pendiente', 'Registration pending'],
    ['overview', 'Resumen', 'Overview'],
    ['pendingPage', 'Página pendiente', 'Page pending'], ['settings', 'Página pendiente', 'Page pending']
  ]) {
    const key = `src/pages/${namespace}.tsx`;
    assert.ok(manifest[key]?.isDynamicEntry, `${namespace} must be a dynamic entry`);
    assert.ok(!eager.has(key), `${namespace} must not be eagerly imported`);
    const code = readFileSync(resolve(dist, manifest[key].file), 'utf8');
    assert.ok(code.includes(spanish) && code.includes(english), `${namespace} bundles both local translations`);
    // The shell also uses Consola/Console, so test unique route titles separately.
    if (namespace !== 'dashboard') {
      assert.ok(!eagerCode.includes(`title:${JSON.stringify(spanish)}`), `${namespace} Spanish resource leaked into entry`);
      assert.ok(!eagerCode.includes(`title:${JSON.stringify(english)}`), `${namespace} English resource leaked into entry`);
    }
  }
});
