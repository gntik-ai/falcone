import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureSchema } from '../../apps/control-plane/tenant-store.mjs';
import { applyGovernanceSchema } from '../../apps/control-plane/governance-schema.mjs';
import * as repository from '../../packages/provisioning-orchestrator/src/repositories/quota-override-repository.mjs';
import { resolveEffectiveLimit } from '../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
import { main as createAction } from '../../packages/provisioning-orchestrator/src/actions/quota-override-create.mjs';
import { main as modifyAction } from '../../packages/provisioning-orchestrator/src/actions/quota-override-modify.mjs';
import { verifyAuditChain } from '../../apps/control-plane/audit-hash.mjs';

const adminContext = { callerContext: { actor: { id: 'admin', type: 'superadmin' } } };
const payload = (tenantId, extra = {}) => ({ tenantId, dimensionKey: 'max_pg_databases', overrideValue: 10, justification: 'pilot', createdBy: 'admin', ...extra });

test('real Postgres quota overrides', async t => {
  const dsn = process.env.QUOTA_OVERRIDES_TEST_DATABASE_URL;
  if (!dsn) {
    assert.notEqual(process.env.QUOTA_OVERRIDES_TEST_REQUIRED, '1', 'CI requires a dedicated real Postgres 17');
    return t.skip('QUOTA_OVERRIDES_TEST_DATABASE_URL is absent; a dedicated real Postgres 17 is required');
  }
  const { default: pg } = await import('pg');
  const schema = `quota_overrides_${randomUUID().replaceAll('-', '')}`;
  const errors = [];
  const watch = pool => {
    pool.on('error', error => errors.push(error));
    pool.on('connect', client => client.on('error', error => errors.push(error)));
    return pool;
  };
  const admin = watch(new pg.Pool({ connectionString: dsn }));
  const pool = watch(new pg.Pool({ connectionString: dsn, options: `-c search_path=${schema}`, max: 8 }));
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await admin.end(); }
    assert.deepEqual(errors, [], 'no unhandled pool or client errors');
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await ensureSchema(pool);
  await applyGovernanceSchema(pool, { repoRoot: fileURLToPath(new URL('../../', import.meta.url)), log: {} });
  const query = pool.query.bind(pool);
  pool.query = (sql, ...args) => {
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, 'transactions belong to a checked-out client');
    return query(sql, ...args);
  };
  const noStores = () => {
    assert.equal(Object.hasOwn(pool, '_quotaOverrides'), false);
    assert.equal(Object.hasOwn(pool, '_planAuditEvents'), false);
  };
  const audits = async tenantId => (await pool.query('SELECT * FROM plan_audit_events WHERE tenant_id=$1 ORDER BY created_at, id', [tenantId])).rows;

  await t.test('create commits the override and audit, and enforcement reads it', async () => {
    const result = await createAction({ ...adminContext, ...payload('create') }, { db: pool });
    assert.equal(result.statusCode, 201);
    const row = await repository.getOverrideById(pool, result.body.overrideId);
    assert.equal(row.overrideValue, 10);
    assert.equal(row.createdBy, 'admin');
    assert.equal((await repository.getActiveOverrideByTenantAndDimension(pool, 'create', 'max_pg_databases')).overrideId, row.overrideId);
    assert.equal((await resolveEffectiveLimit(pool, 'create', 'max_pg_databases')).effectiveLimit, 10);
    assert.deepEqual((await audits('create')).map(row => row.action_type), ['quota.override.created']);
    assert.equal((await audits('create'))[0].new_state.overrideId, row.overrideId);
    noStores();
  });

  await t.test('supersedes under concurrency without violating the active-row index', async () => {
    const first = await repository.createOverride(pool, payload('supersede'));
    const second = await repository.createOverride(pool, payload('supersede', { overrideValue: 12 }));
    assert.equal(second.supersededOverrideId, first.override.overrideId);
    const prior = await repository.getOverrideById(pool, first.override.overrideId);
    assert.equal(prior.status, 'superseded');
    assert.equal(prior.supersededBy, second.override.overrideId);
    assert.deepEqual((await audits('supersede')).map(row => row.action_type), ['quota.override.created', 'quota.override.superseded']);
    const results = await Promise.allSettled([10, 20].map(overrideValue => repository.createOverride(pool, payload('concurrent', { overrideValue }))));
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled']);
    const rows = (await pool.query("SELECT * FROM quota_overrides WHERE tenant_id='concurrent'")).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(row => row.status === 'active').length, 1);
    assert.equal(rows.find(row => row.status === 'superseded').superseded_by, rows.find(row => row.status === 'active').id);
    assert.deepEqual((await audits('concurrent')).map(row => row.action_type), ['quota.override.created', 'quota.override.superseded']);
    assert.deepEqual(verifyAuditChain(await audits('concurrent')), { valid: true, brokenAt: null });
    noStores();
  });
  await t.test('modify persists whitelisted changes and an audit', async () => {
    const { override } = await repository.createOverride(pool, payload('modify'));
    const expiresAt = '2099-01-01T00:00:00.000Z';
    const result = await repository.modifyOverride(pool, { overrideId: override.overrideId, actorId: 'editor', justification: 'larger pilot', changes: { overrideValue: 25, quotaType: 'soft', graceMargin: 3, expiresAt, status: 'revoked', 'override_value = 0 --': 0 } });
    assert.deepEqual(result.previousState, { overrideValue: 10, quotaType: 'hard', graceMargin: 0, expiresAt: null });
    assert.equal(result.newState.overrideValue, 25);
    const row = await repository.getOverrideById(pool, override.overrideId);
    assert.equal(row.overrideValue, 25);
    assert.equal(row.quotaType, 'soft');
    assert.equal(row.graceMargin, 3);
    assert.equal(new Date(row.expiresAt).toISOString(), expiresAt);
    assert.equal(row.status, 'active');
    assert.equal(row.modifiedBy, 'editor');
    assert.ok(row.modifiedAt);
    assert.equal(row.modificationJustification, 'larger pilot');
    const audit = (await audits('modify')).at(-1);
    assert.equal(audit.action_type, 'quota.override.modified');
    assert.equal(audit.previous_state.overrideValue, 10);
    assert.equal(audit.new_state.overrideValue, 25);
    noStores();
  });
  await t.test('revoke persists metadata and audit, and inactive or missing ids fail', async () => {
    const { override } = await repository.createOverride(pool, payload('revoke'));
    const row = await repository.revokeOverride(pool, { overrideId: override.overrideId, actorId: 'revoker', justification: 'pilot ended' });
    assert.equal(row.status, 'revoked');
    assert.equal(row.revokedBy, 'revoker');
    assert.ok(row.revokedAt);
    assert.equal(row.revocationJustification, 'pilot ended');
    assert.deepEqual(await repository.getOverrideById(pool, row.overrideId), row);
    assert.deepEqual((await audits('revoke')).map(row => row.action_type), ['quota.override.created', 'quota.override.revoked']);
    const params = { overrideId: row.overrideId, actorId: 'admin', justification: 'retry', changes: { overrideValue: 30 } };
    await assert.rejects(repository.modifyOverride(pool, params), { code: 'OVERRIDE_NOT_ACTIVE' });
    await assert.rejects(repository.revokeOverride(pool, params), { code: 'OVERRIDE_NOT_ACTIVE' });
    for (const operation of [repository.modifyOverride, repository.revokeOverride]) {
      await assert.rejects(operation(pool, { ...params, overrideId: randomUUID() }), { code: 'OVERRIDE_NOT_FOUND' });
    }
    await assert.rejects(modifyAction({ ...adminContext, overrideId: randomUUID(), justification: 'missing', overrideValue: 30 }, { db: pool }), { code: 'OVERRIDE_NOT_FOUND', statusCode: 404 });
    assert.equal((await audits('revoke')).length, 2);
    noStores();
  });
  await t.test('list filters persisted rows and returns exact totals across pages', async () => {
    const ids = [];
    for (let day = 1; day <= 5; day++) {
      const { override } = await repository.createOverride(pool, payload('paging', { createdAt: `2026-01-0${day}T00:00:00.000Z` }));
      ids.push(override.overrideId);
    }
    for (const [page, expected] of [[1, [ids[4], ids[3]]], [2, [ids[2], ids[1]]], [3, [ids[0]]], [4, []]]) {
      const result = await repository.listOverrides(pool, { tenantId: 'paging', status: null, page, pageSize: 2 });
      assert.equal(result.total, 5);
      assert.equal(result.page, page);
      assert.equal(result.pageSize, 2);
      assert.deepEqual(result.overrides.map(row => row.overrideId), expected);
    }
    assert.equal((await repository.listOverrides(pool, { tenantId: 'paging' })).total, 1);
    assert.equal((await repository.listOverrides(pool, { tenantId: 'paging', status: 'superseded', dimensionKey: 'max_pg_databases' })).total, 4);
    assert.equal((await repository.listOverrides(pool, { tenantId: 'paging', dimensionKey: 'max_functions' })).total, 0);
    noStores();
  });
  await t.test('expiry changes only due active rows, with bounded batches and one audit each', async () => {
    const due = [];
    for (const [tenantId, expiresAt] of [['expiry-one', '2098-01-01T00:00:00.000Z'], ['expiry-two', '2098-01-01T12:00:00.000Z'], ['expiry-equal', '2098-01-02T00:00:00.000Z']]) {
      due.push((await repository.createOverride(pool, payload(tenantId, { expiresAt }))).override.overrideId);
    }
    const future = (await repository.createOverride(pool, payload('expiry-future', { expiresAt: '2098-01-03T00:00:00.000Z' }))).override;
    const forever = (await repository.createOverride(pool, payload('expiry-forever'))).override;
    const revoked = (await repository.createOverride(pool, payload('expiry-revoked', { expiresAt: '2098-01-01T00:00:00.000Z' }))).override;
    await repository.revokeOverride(pool, { overrideId: revoked.overrideId, actorId: 'admin', justification: 'ended' });
    const old = (await repository.createOverride(pool, payload('expiry-superseded', { expiresAt: '2098-01-01T00:00:00.000Z' }))).override;
    await repository.createOverride(pool, payload('expiry-superseded'));
    const params = { now: new Date('2098-01-02T00:00:00.000Z'), batchSize: 2 };
    const first = await repository.expireOverrides(pool, params);
    assert.equal(first.length, 2);
    assert.ok(first.every(row => row.status === 'expired'));
    const second = await repository.expireOverrides(pool, params);
    assert.equal(second.length, 1);
    assert.deepEqual(new Set([...first, ...second].map(row => row.overrideId)), new Set(due));
    assert.deepEqual(await repository.expireOverrides(pool, params), []);
    for (const id of due) assert.equal((await repository.getOverrideById(pool, id)).status, 'expired');
    for (const row of [future, forever]) assert.equal((await repository.getOverrideById(pool, row.overrideId)).status, 'active');
    assert.equal((await repository.getOverrideById(pool, revoked.overrideId)).status, 'revoked');
    assert.equal((await repository.getOverrideById(pool, old.overrideId)).status, 'superseded');
    for (const tenantId of ['expiry-one', 'expiry-two', 'expiry-equal']) {
      assert.equal((await audits(tenantId)).filter(row => row.action_type === 'quota.override.expired').length, 1);
    }
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM plan_audit_events WHERE action_type='quota.override.expired'")).rows[0].n, 3);
    noStores();
  });
  await t.test('audit failures roll back create, supersede, modify, revoke and the entire expiry batch', async () => {
    const original = (await repository.createOverride(pool, payload('rollback-existing'))).override;
    const editable = (await repository.createOverride(pool, payload('rollback-editable'))).override;
    const due = [];
    for (const tenantId of ['rollback-expiry-one', 'rollback-expiry-two']) {
      due.push((await repository.createOverride(pool, payload(tenantId, { expiresAt: '2097-01-01T00:00:00.000Z' }))).override);
    }
    const beforeAudits = (await pool.query("SELECT * FROM plan_audit_events WHERE tenant_id LIKE 'rollback-%' ORDER BY id")).rows;
    await pool.query(`CREATE FUNCTION reject_quota_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action_type LIKE 'quota.override.%' THEN RAISE EXCEPTION 'forced quota audit failure'; END IF;
        RETURN NEW;
      END; $$`);
    await pool.query('CREATE TRIGGER reject_quota_audit BEFORE INSERT ON plan_audit_events FOR EACH ROW EXECUTE FUNCTION reject_quota_audit()');
    try {
      await assert.rejects(createAction({ ...adminContext, ...payload('rollback-empty') }, { db: pool }), { message: 'forced quota audit failure', statusCode: 500 });
      assert.equal((await repository.listOverrides(pool, { tenantId: 'rollback-empty', status: null })).total, 0);
      await assert.rejects(repository.createOverride(pool, payload('rollback-existing', { overrideValue: 40 })), /forced quota audit failure/);
      assert.deepEqual(await repository.getOverrideById(pool, original.overrideId), original);
      assert.equal((await repository.listOverrides(pool, { tenantId: 'rollback-existing', status: null })).total, 1);
      await assert.rejects(repository.modifyOverride(pool, { overrideId: editable.overrideId, actorId: 'admin', justification: 'edit', changes: { overrideValue: 40 } }), /forced quota audit failure/);
      assert.deepEqual(await repository.getOverrideById(pool, editable.overrideId), editable);
      await assert.rejects(repository.revokeOverride(pool, { overrideId: editable.overrideId, actorId: 'admin', justification: 'revoke' }), /forced quota audit failure/);
      assert.deepEqual(await repository.getOverrideById(pool, editable.overrideId), editable);
      await assert.rejects(repository.expireOverrides(pool, { now: new Date('2097-01-02T00:00:00.000Z'), batchSize: 2 }), /forced quota audit failure/);
      for (const row of due) assert.deepEqual(await repository.getOverrideById(pool, row.overrideId), row);
      assert.deepEqual((await pool.query("SELECT * FROM plan_audit_events WHERE tenant_id LIKE 'rollback-%' ORDER BY id")).rows, beforeAudits);
      noStores();
    } finally {
      await pool.query('DROP TRIGGER reject_quota_audit ON plan_audit_events');
      await pool.query('DROP FUNCTION reject_quota_audit()');
    }
  });

  await t.test('an already connected client is used directly and remains owned by the caller', async () => {
    const client = await pool.connect();
    const db = {
      query: client.query.bind(client),
      connect() { assert.fail('must not reconnect a client'); },
      release() { assert.fail('must not release a caller-owned client'); },
    };
    try {
      const { override } = await repository.createOverride(db, payload('client'));
      await repository.modifyOverride(db, { overrideId: override.overrideId, actorId: 'admin', justification: 'edit', changes: { overrideValue: 20 } });
      assert.equal((await repository.listOverrides(db, { tenantId: 'client' })).overrides[0].overrideValue, 20);
      await repository.revokeOverride(db, { overrideId: override.overrideId, actorId: 'admin', justification: 'done' });
      await repository.expireOverrides(db, { now: new Date('2097-01-02T00:00:00.000Z') });
      assert.equal((await client.query('SELECT 1 AS usable')).rows[0].usable, 1);
      assert.equal(Object.hasOwn(db, '_quotaOverrides'), false);
      assert.equal(Object.hasOwn(db, '_planAuditEvents'), false);
      noStores();
    } finally { client.release(); }
  });
});
