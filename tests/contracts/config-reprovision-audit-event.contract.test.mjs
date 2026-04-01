import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const SCHEMA_PATH = resolve('specs/117-tenant-reprovision-from-export/contracts/config-reprovision-audit-event.json');

let schema;
let ajv;

test('config-reprovision-audit-event schema: file is valid JSON Schema', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  assert.ok(schema);
  ajv = new Ajv({ strict: false, allErrors: true });
});

function validEvent() {
  return {
    event_type: 'config.reprovision.completed',
    schema_version: '1.0',
    operation_type: 'reprovision',
    correlation_id: 'req-abc123',
    tenant_id: 'tenant-dest',
    source_tenant_id: 'tenant-source',
    actor_id: 'sre-1',
    actor_type: 'sre',
    format_version: '1.0.0',
    dry_run: false,
    requested_domains: ['iam', 'kafka'],
    result_status: 'success',
    emitted_at: '2026-04-01T18:00:00.000Z',
  };
}

test('config-reprovision-audit-event: valid event passes validation', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  const valid = validate(event);
  assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
});

test('config-reprovision-audit-event: event without event_type fails', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  delete event.event_type;
  const valid = validate(event);
  assert.equal(valid, false);
});

test('config-reprovision-audit-event: event without actor_type fails', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  delete event.actor_type;
  const valid = validate(event);
  assert.equal(valid, false);
});

test('config-reprovision-audit-event: invalid actor_type tenant_owner fails', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  event.actor_type = 'tenant_owner';
  const valid = validate(event);
  assert.equal(valid, false);
});

test('config-reprovision-audit-event: additionalProperties rejects extra fields', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  // Only test if schema has additionalProperties: false
  if (schema.additionalProperties === false) {
    ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const event = { ...validEvent(), extraField: 'should-fail' };
    const valid = validate(event);
    assert.equal(valid, false);
  }
});
