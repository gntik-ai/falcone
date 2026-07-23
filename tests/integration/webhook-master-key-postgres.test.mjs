import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { recordAuditEventInTransaction } from '../../apps/control-plane/audit-store.mjs';
import { buildWebhookMasterKeyRepository } from '../../packages/webhook-engine/src/webhook-master-key-lifecycle.mjs';
import {
  createCanonicalWebhookKeyContext,
  createLifecycleWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';
import { decryptSecret, encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';

const { Pool } = pg;
const databaseUrl = process.env.WEBHOOK_KEY_TEST_DATABASE_URL;

test('migration 004 and the lifecycle execute transactionally on PostgreSQL', {
  skip: databaseUrl ? false : 'WEBHOOK_KEY_TEST_DATABASE_URL is not configured',
}, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  t.after(() => pool.end());
  const migration = async (name) => pool.query(await readFile(new URL(`../../packages/webhook-engine/migrations/${name}`, import.meta.url), 'utf8'));

  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plan_audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_type VARCHAR(64) NOT NULL,
      actor_id VARCHAR(255) NOT NULL,
      tenant_id VARCHAR(255),
      plan_id UUID,
      previous_state JSONB,
      new_state JSONB NOT NULL,
      outcome VARCHAR(32),
      correlation_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      prev_hash TEXT,
      row_hash TEXT
    )`);
  await migration('001-webhook-subscriptions.sql');
  const legacyId = deriveWebhookKeyId('test-ns', 'legacy-key', 'key');
  const targetId = deriveWebhookKeyId('test-ns', 'canonical-key', 'key');
  const legacyMaterial = 'synthetic-postgres-legacy-fixture';
  const targetMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x51));
  const legacy = createLifecycleWebhookKeyContext({
    material: legacyMaterial, keyId: legacyId, mode: 'legacy', purpose: 'adopt',
  });
  const fixtures = [
    { subscription: '10000000-0000-4000-8000-000000000001', secret: 'tenant-a-secret', tenant: 'tenant-a', workspace: 'workspace-a', status: 'active' },
    { subscription: '20000000-0000-4000-8000-000000000002', secret: 'tenant-b-secret', tenant: 'tenant-b', workspace: 'workspace-b', status: 'grace' },
    { subscription: '30000000-0000-4000-8000-000000000003', secret: 'tenant-a-revoked-secret', tenant: 'tenant-a', workspace: 'workspace-c', status: 'revoked' },
  ];
  for (const fixture of fixtures) {
    const encrypted = encryptSecret(fixture.secret, legacy);
    await pool.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES ($1,$2,$3,'https://example.invalid/hook',ARRAY['tenant.created'],'postgres-test')`,
      [fixture.subscription, fixture.tenant, fixture.workspace],
    );
    await pool.query(
      `INSERT INTO webhook_signing_secrets
         (subscription_id, secret_cipher, secret_iv, status, grace_expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,
         CASE WHEN $4 = 'grace' THEN now() + interval '1 day' END,
         CASE WHEN $4 = 'revoked' THEN now() END)`,
      [fixture.subscription, encrypted.cipher, encrypted.iv, fixture.status],
    );
  }

  await migration('002-signing-secret-tenant-scope.sql');
  await migration('004-webhook-master-key-lifecycle.sql');
  await migration('004-webhook-master-key-lifecycle.sql');

  const repository = buildWebhookMasterKeyRepository(pool, {
    auditWriter: recordAuditEventInTransaction,
  });
  const truncateLifecycleFixtures = () => pool.query(
    `TRUNCATE webhook_delivery_attempts, webhook_deliveries, webhook_signing_secrets,
              webhook_subscriptions, webhook_master_key_rotations, webhook_master_key_state,
              plan_audit_events
       RESTART IDENTITY CASCADE`,
  );
  const adopted = await repository.adopt({
    material: legacyMaterial, keyId: legacyId, managed: false,
    requestId: 'postgres-adopt-001',
  });
  assert.equal(adopted.affectedCount, fixtures.length);
  const before = (await pool.query(
    `SELECT id, subscription_id, tenant_id, workspace_id, status, grace_expires_at,
            created_at, revoked_at
       FROM webhook_signing_secrets ORDER BY subscription_id`,
  )).rows;

  await repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  });
  const target = createCanonicalWebhookKeyContext(targetMaterial, targetId);
  const transformed = (await pool.query(
    `SELECT id, subscription_id, tenant_id, workspace_id, status, grace_expires_at,
            created_at, revoked_at, secret_cipher, secret_iv, encryption_key_id
       FROM webhook_signing_secrets ORDER BY subscription_id`,
  )).rows;
  assert.deepEqual(
    transformed.map(({ secret_cipher, secret_iv, encryption_key_id, ...row }) => row),
    before,
  );
  assert.deepEqual(
    transformed.map((row) => decryptSecret(row.secret_cipher, row.secret_iv, target)),
    fixtures.map(({ secret }) => secret),
  );
  assert.ok(transformed.every((row) => row.encryption_key_id === targetId));

  const replay = await repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'postgres-rotate-001', rotationId: 'postgres-rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  });
  assert.equal(replay.state, 'completed');
  assert.equal((await pool.query(
    `SELECT count(*)::int AS count FROM webhook_master_key_rotations
      WHERE request_id = 'postgres-rotate-001'`,
  )).rows[0].count, 1);
  const rotateAudit = (await pool.query(
    `SELECT action_type, actor_id, tenant_id, outcome, correlation_id, new_state
       FROM plan_audit_events
      WHERE correlation_id = 'postgres-rotate-001'`,
  )).rows[0];
  assert.equal(rotateAudit.action_type, 'webhook.master-key.rotate');
  assert.equal(rotateAudit.actor_id, 'falcone:platform-maintenance');
  assert.equal(rotateAudit.tenant_id, null);
  assert.equal(rotateAudit.outcome, 'succeeded');
  assert.equal(rotateAudit.new_state.affectedCount, fixtures.length);
  assert.equal(rotateAudit.new_state.verifiedCount, fixtures.length);
  assert.doesNotMatch(JSON.stringify(rotateAudit), /secret_cipher|secret_iv|v1:[A-Za-z0-9_-]{43}/);

  const recovered = await repository.recover({
    currentMaterial: targetMaterial, currentKeyId: targetId, currentMode: 'canonical-v1',
    targetMaterial: legacyMaterial, targetKeyId: legacyId, targetMode: 'legacy',
    targetManaged: false,
    requestId: 'postgres-recover-001', rotationId: 'postgres-recovery-001',
    recoveryWindowSeconds: 3600, quiesced: true, now: new Date(),
  });
  assert.equal(recovered.affectedCount, fixtures.length);
  await pool.query(
    `UPDATE webhook_master_key_state
        SET recovery_deadline = '2026-07-23T11:00:00.000Z'
      WHERE singleton_id = 1`,
  );
  await pool.query(
    `UPDATE webhook_signing_secrets SET encryption_key_id = NULL
      WHERE id = (SELECT id FROM webhook_signing_secrets ORDER BY id LIMIT 1)`,
  );
  await assert.rejects(repository.finalize({
    material: legacyMaterial, keyId: legacyId, mode: 'legacy',
    recoveryKeyId: targetId, requestId: 'postgres-finalize-mixed',
    now: new Date('2026-07-23T12:00:00.000Z'),
  }), { code: 'WEBHOOK_ROW_KEY_MISMATCH' });
  assert.equal((await pool.query(
    'SELECT recovery_key_id FROM webhook_master_key_state WHERE singleton_id = 1',
  )).rows[0].recovery_key_id, targetId);
  await pool.query(
    'UPDATE webhook_signing_secrets SET encryption_key_id = $1 WHERE encryption_key_id IS NULL',
    [legacyId],
  );
  const finalized = await repository.finalize({
    material: legacyMaterial, keyId: legacyId, mode: 'legacy',
    recoveryKeyId: targetId, requestId: 'postgres-finalize-001',
    now: new Date('2026-07-23T12:00:00.000Z'),
  });
  assert.equal(finalized.affectedCount, fixtures.length);
  assert.equal((await pool.query(
    'SELECT recovery_key_id FROM webhook_master_key_state WHERE singleton_id = 1',
  )).rows[0].recovery_key_id, null);

  const lifecycleColumns = (await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('webhook_master_key_state','webhook_master_key_rotations')`,
  )).rows.map(({ column_name }) => column_name);
  assert.ok(lifecycleColumns.every((name) => !/(key_bytes|key_digest|plaintext|secret_value)/.test(name)));

  await truncateLifecycleFixtures();
  const initialized = await repository.initializeOrVerify({
    material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true,
  });
  assert.equal(initialized.keyId, targetId);
  assert.equal((await repository.initializeOrVerify({
    material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true,
  })).keyId, targetId);
  await assert.rejects(repository.initializeOrVerify({
    material: formatCanonicalWebhookKey(Buffer.alloc(32, 0x52)),
    keyId: targetId, mode: 'canonical-v1', managed: true,
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });

  await pool.query(
    `INSERT INTO webhook_subscriptions
       (id, tenant_id, workspace_id, target_url, event_types, created_by)
     VALUES ('40000000-0000-4000-8000-000000000004','tenant-c','workspace-d',
       'https://example.invalid/hook',ARRAY['tenant.created'],'postgres-test')`,
  );
  const unlabeled = encryptSecret('unlabeled-secret', target);
  await pool.query(
    `INSERT INTO webhook_signing_secrets
       (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status, encryption_key_id)
     VALUES ('40000000-0000-4000-8000-000000000004','tenant-c','workspace-d',$1,$2,'active',NULL)`,
    [unlabeled.cipher, unlabeled.iv],
  );
  await assert.rejects(repository.initializeOrVerify({
    material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true,
  }), { code: 'WEBHOOK_ROW_KEY_MISMATCH' });

  const custodyDirections = [
    { name: 'external-to-external', currentManaged: false, recoveryManaged: false },
    { name: 'external-to-managed', currentManaged: false, recoveryManaged: true },
    { name: 'managed-to-external', currentManaged: true, recoveryManaged: false },
    { name: 'managed-to-managed', currentManaged: true, recoveryManaged: true },
  ];
  for (const [index, direction] of custodyDirections.entries()) {
    await truncateLifecycleFixtures();
    const caseLegacyId = deriveWebhookKeyId(
      'test-ns',
      `legacy-key-${direction.name}`,
      'key',
    );
    const caseTargetId = deriveWebhookKeyId(
      'test-ns',
      `canonical-key-${direction.name}`,
      'key',
    );
    const caseLegacyMaterial = `synthetic-postgres-${direction.name}-legacy`;
    const caseTargetMaterial = formatCanonicalWebhookKey(
      Buffer.alloc(32, 0x60 + index),
    );
    const caseLegacy = createLifecycleWebhookKeyContext({
      material: caseLegacyMaterial,
      keyId: caseLegacyId,
      mode: 'legacy',
      purpose: 'adopt',
    });
    const encrypted = encryptSecret(`secret-${direction.name}`, caseLegacy);
    const subscriptionId = `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await pool.query(
      `INSERT INTO webhook_subscriptions
         (id, tenant_id, workspace_id, target_url, event_types, created_by)
       VALUES ($1,$2,$3,'https://example.invalid/hook',
         ARRAY['tenant.created'],'postgres-custody-test')`,
      [subscriptionId, `tenant-${index}`, `workspace-${index}`],
    );
    await pool.query(
      `INSERT INTO webhook_signing_secrets
         (subscription_id, tenant_id, workspace_id, secret_cipher, secret_iv, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [
        subscriptionId,
        `tenant-${index}`,
        `workspace-${index}`,
        encrypted.cipher,
        encrypted.iv,
      ],
    );

    const adoptRequestId = `postgres-adopt-${direction.name}`;
    await repository.adopt({
      material: caseLegacyMaterial,
      keyId: caseLegacyId,
      managed: direction.recoveryManaged,
      requestId: adoptRequestId,
    });
    await assert.rejects(repository.adopt({
      material: caseLegacyMaterial,
      keyId: caseLegacyId,
      managed: !direction.recoveryManaged,
      requestId: adoptRequestId,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const adoptBinding = {
      requestId: adoptRequestId,
      action: 'adopt',
      targetKeyId: caseLegacyId,
      targetManaged: direction.recoveryManaged,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(adoptBinding)).targetManaged,
      direction.recoveryManaged,
    );
    await assert.rejects(repository.authorizeQuiescedReplay({
      ...adoptBinding,
      targetManaged: !direction.recoveryManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });

    const rotateRequest = {
      sourceMaterial: caseLegacyMaterial,
      sourceKeyId: caseLegacyId,
      sourceMode: 'legacy',
      targetMaterial: caseTargetMaterial,
      targetKeyId: caseTargetId,
      targetManaged: direction.currentManaged,
      requestId: `postgres-rotate-${direction.name}`,
      rotationId: `postgres-rotation-${direction.name}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    };
    await repository.rotate(rotateRequest);
    await assert.rejects(repository.rotate({
      ...rotateRequest,
      targetManaged: !direction.currentManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const rotateBinding = {
      requestId: rotateRequest.requestId,
      action: 'rotate',
      rotationId: rotateRequest.rotationId,
      sourceKeyId: caseLegacyId,
      targetKeyId: caseTargetId,
      targetManaged: direction.currentManaged,
      recoveryWindowSeconds: 3600,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(rotateBinding)).targetManaged,
      direction.currentManaged,
    );
    await assert.rejects(repository.authorizeQuiescedReplay({
      ...rotateBinding,
      targetManaged: !direction.currentManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });

    const beforeMismatchState = (await pool.query(
      'SELECT * FROM webhook_master_key_state WHERE singleton_id = 1',
    )).rows[0];
    const beforeMismatchRows = (await pool.query(
      `SELECT id, secret_cipher, secret_iv, encryption_key_id
         FROM webhook_signing_secrets ORDER BY id`,
    )).rows;
    const mismatchRequestId = `postgres-recover-mismatch-${direction.name}`;
    await assert.rejects(repository.recover({
      currentMaterial: caseTargetMaterial,
      currentKeyId: caseTargetId,
      currentMode: 'canonical-v1',
      targetMaterial: caseLegacyMaterial,
      targetKeyId: caseLegacyId,
      targetMode: 'legacy',
      targetManaged: !direction.recoveryManaged,
      requestId: mismatchRequestId,
      rotationId: `postgres-recovery-mismatch-${direction.name}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    }), { code: 'WEBHOOK_KEY_CUSTODY_CONFLICT' });
    assert.deepEqual((await pool.query(
      'SELECT * FROM webhook_master_key_state WHERE singleton_id = 1',
    )).rows[0], beforeMismatchState);
    assert.deepEqual((await pool.query(
      `SELECT id, secret_cipher, secret_iv, encryption_key_id
         FROM webhook_signing_secrets ORDER BY id`,
    )).rows, beforeMismatchRows);
    const mismatchLedger = (await pool.query(
      `SELECT target_managed, lifecycle_state, error_code, error_message
         FROM webhook_master_key_rotations WHERE request_id = $1`,
      [mismatchRequestId],
    )).rows[0];
    assert.equal(mismatchLedger.target_managed, !direction.recoveryManaged);
    assert.equal(mismatchLedger.lifecycle_state, 'failed');
    assert.equal(mismatchLedger.error_code, 'WEBHOOK_KEY_CUSTODY_CONFLICT');
    assert.equal(
      mismatchLedger.error_message,
      'Webhook key custody conflicts with durable lifecycle state',
    );

    const recoverRequest = {
      currentMaterial: caseTargetMaterial,
      currentKeyId: caseTargetId,
      currentMode: 'canonical-v1',
      targetMaterial: caseLegacyMaterial,
      targetKeyId: caseLegacyId,
      targetMode: 'legacy',
      targetManaged: direction.recoveryManaged,
      requestId: `postgres-recover-${direction.name}`,
      rotationId: `postgres-recovery-${direction.name}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    };
    const custodyRecovery = await repository.recover(recoverRequest);
    assert.equal(custodyRecovery.sourceManaged, direction.currentManaged);
    assert.equal(custodyRecovery.targetManaged, direction.recoveryManaged);
    const recoveredState = (await pool.query(
      `SELECT current_key_id, current_managed, recovery_key_id, recovery_managed
         FROM webhook_master_key_state WHERE singleton_id = 1`,
    )).rows[0];
    assert.deepEqual(recoveredState, {
      current_key_id: caseLegacyId,
      current_managed: direction.recoveryManaged,
      recovery_key_id: caseTargetId,
      recovery_managed: direction.currentManaged,
    });
    const recoveredLedger = (await pool.query(
      `SELECT source_managed, target_managed
         FROM webhook_master_key_rotations WHERE request_id = $1`,
      [recoverRequest.requestId],
    )).rows[0];
    assert.deepEqual(recoveredLedger, {
      source_managed: direction.currentManaged,
      target_managed: direction.recoveryManaged,
    });
    const recoveredAudit = (await pool.query(
      `SELECT new_state FROM plan_audit_events
        WHERE correlation_id = $1 AND outcome = 'succeeded'`,
      [recoverRequest.requestId],
    )).rows[0].new_state;
    assert.equal(recoveredAudit.sourceManaged, direction.currentManaged);
    assert.equal(recoveredAudit.targetManaged, direction.recoveryManaged);
    await assert.rejects(repository.recover({
      ...recoverRequest,
      targetManaged: !direction.recoveryManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
    const recoverBinding = {
      requestId: recoverRequest.requestId,
      action: 'recover',
      rotationId: recoverRequest.rotationId,
      sourceKeyId: caseTargetId,
      targetKeyId: caseLegacyId,
      targetManaged: direction.recoveryManaged,
      recoveryWindowSeconds: 3600,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(recoverBinding)).targetManaged,
      direction.recoveryManaged,
    );
    await assert.rejects(repository.authorizeQuiescedReplay({
      ...recoverBinding,
      targetManaged: !direction.recoveryManaged,
    }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
  }
  await truncateLifecycleFixtures();
});
