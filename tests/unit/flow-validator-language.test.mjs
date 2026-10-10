import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('shared flow validator contains no Spanish copy or locale table', () => {
  const source = readFileSync(new URL('../../packages/internal-contracts/src/flow-definition-validator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:nodos?|flujo|rama|expresión|duración|programación|configurado|catálogo|desconocido|duplicado)\b|[áéíóúñü¿¡]/i);
});
