// Webhook schema bootstrap for the kind control-plane (#643).
//
// The webhook management plane (webhook-handlers.mjs -> webhook-management action)
// reads/writes webhook_subscriptions / webhook_signing_secrets / webhook_deliveries
// / webhook_delivery_attempts. Those relations live in the webhook-engine MIGRATIONS
// (packages/webhook-engine/migrations) — no in-repo kind migration creates them — so,
// like applyGovernanceSchema, this module applies the migration set at boot.
//
// We apply 001 (tables) + 002 (tenant_id/workspace_id columns on the secrets table)
// + 004 (platform master-key lifecycle metadata)
// ONLY. Migration 003 (FORCE ROW LEVEL SECURITY) is intentionally NOT applied here:
// its policies key on current_setting('app.tenant_id') and FORCE RLS makes even the
// table owner subject to them, so without a `SET LOCAL app.tenant_id` connection
// wrapper EVERY webhook query would match zero rows and break the management plane.
// On kind, tenant isolation is enforced in the webhook-db.mjs adapter SQL (every
// scoped query carries an AND tenant_id = $ AND workspace_id = $ predicate) — the
// same app-level model the runtime's other domain-B tables use. Rolling out
// database-enforced RLS (with the GUC-setting connection wrapper) is the dedicated
// RLS feature's job, not this change.
//
// Every statement is CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so
// re-running boot is a no-op (idempotent). The packages/webhook-engine tree is
// COPYd into the image under /repo by apps/control-plane/Dockerfile.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const WEBHOOK_MIGRATIONS = [
  'packages/webhook-engine/migrations/001-webhook-subscriptions.sql',
  'packages/webhook-engine/migrations/002-signing-secret-tenant-scope.sql',
  'packages/webhook-engine/migrations/004-webhook-master-key-lifecycle.sql',
];

const DEFAULT_REPO_ROOT = process.env.REPO_ROOT || '/repo';

/**
 * Apply the webhook schema (migrations 001 + 002 + 004) to the in_falcone database.
 * Idempotent. Injectable I/O for tests.
 *
 * @param {{query:(sql:string)=>Promise<any>}} pool  control-plane Postgres pool
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 * @param {(p:string,enc:string)=>Promise<string>} [opts.read]
 * @param {{log:Function}} [opts.log]
 * @returns {Promise<string[]>}  the migration paths applied, in order
 */
export async function applyWebhookSchema(pool, opts = {}) {
  const { repoRoot = DEFAULT_REPO_ROOT, read = readFile, log = console } = opts;
  const applied = [];
  for (const rel of WEBHOOK_MIGRATIONS) {
    const sql = await read(resolve(repoRoot, rel), 'utf8');
    await pool.query(sql);
    applied.push(rel);
  }
  log.log?.(`[control-plane] webhook schema ready (${applied.length} migrations)`);
  return applied;
}
