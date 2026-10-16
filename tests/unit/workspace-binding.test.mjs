import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspaceBinding } from '../../packages/internal-contracts/src/workspace-binding.mjs';

const valid = [
  ['absent', undefined, undefined, undefined, undefined],
  ['null', null, null, undefined, undefined],
  ['null singular', null, ['B'], undefined, ['B']],
  ['null plural', 'B', null, 'B', undefined],
  ['singular', 'B', undefined, 'B', undefined],
  ['plural array', undefined, ['B', 'A', 'B'], undefined, ['B', 'A']],
  ['plural string', undefined, ' B, A B ', undefined, ['B', 'A']],
  ['empty array', undefined, [], undefined, []],
  ['empty string', undefined, '', undefined, []],
  ['empty separators', undefined, ' , , ', undefined, []],
  ['equal pair', 'B', ['B'], 'B', ['B']],
  ['equal duplicates', 'B', ['B', 'B'], 'B', ['B']],
  ['equal string', 'B', 'B', 'B', ['B']],
  ['equal string duplicates', 'B', 'B,B', 'B', ['B']],
];
const invalid = [
  ['array singular', ['B'], undefined],
  ['number singular', 7, undefined],
  ['empty singular', '', undefined],
  ['spaces singular', 'A B', undefined],
  ['comma singular', 'A,B', undefined],
  ['object singular', {}, undefined],
  ['boolean singular', false, undefined],
  ['nested plural', undefined, [['B']]],
  ['number element', undefined, ['A', 7]],
  ['empty element', undefined, ['']],
  ['spaces element', undefined, ['A B']],
  ['comma element', undefined, ['A,B']],
  ['object plural', undefined, {}],
  ['number plural', undefined, 7],
  ['boolean plural', undefined, false],
  ['tab plural', undefined, 'A\tB'],
  ['different pair', 'A', ['B']],
  ['additional workspace', 'A', ['A', 'B']],
  ['empty array pair', 'A', []],
  ['empty string pair', 'A', ''],
  ['empty separators pair', 'A', ','],
  ['different string pair', 'A', 'B'],
];

for (const [name, singular, plural, normalizedSingular, normalizedPlural] of valid) {
  test(`workspace binding accepts ${name}`, () => {
    assert.deepEqual(normalizeWorkspaceBinding(singular, plural), {
      valid: true, singular: normalizedSingular, plural: normalizedPlural,
    });
  });
}
for (const [name, singular, plural] of invalid) {
  test(`workspace binding rejects ${name}`, () => {
    assert.deepEqual(normalizeWorkspaceBinding(singular, plural), {
      valid: false, singular: undefined, plural: undefined,
    });
  });
}
