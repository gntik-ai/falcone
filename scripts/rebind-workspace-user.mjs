import { pathToFileURL } from 'node:url';
import { kcAdmin as defaultKcAdmin, normalizeKeycloakAttributes } from '../apps/control-plane/kc-admin.mjs';
import { MigrationConflict, safeFailure } from './lib/workspace-service-accounts.mjs';

export function parseRebindArgs(argv = []) {
  const options = { dryRun: true };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else {
      const key = ['--tenant', '--user', '--workspace'].includes(arg) ? arg.slice(2) : undefined;
      const value = argv[++index];
      if (!key || options[key] !== undefined || !value || value.startsWith('-') || /[,\s\[\]]/.test(value)) {
        throw new MigrationConflict('expected-one-tenant-one-user-one-workspace');
      }
      options[key] = value;
    }
  }
  if (!options.tenant || !options.user || !options.workspace) throw new MigrationConflict('expected-one-tenant-one-user-one-workspace');
  return options;
}

export async function runRebind({ argv = [], pool, kcAdmin = defaultKcAdmin, outStream = process.stdout } = {}) {
  const report = (exitCode, reason, extra = {}) => {
    const result = { reason, ...extra };
    outStream.write(`${JSON.stringify(result)}\n`);
    return { exitCode, result };
  };
  let options;
  try { options = parseRebindArgs(argv); }
  catch { return report(2, 'expected-one-tenant-one-user-one-workspace'); }
  try {
    const tenant = (await pool.query('SELECT id, iam_realm FROM tenants WHERE id = $1', [options.tenant])).rows[0];
    if (!tenant?.iam_realm) return report(8, 'unknown-tenant');
    const workspace = (await pool.query('SELECT id, tenant_id FROM workspaces WHERE id = $1', [options.workspace])).rows[0];
    if (!workspace) return report(3, 'unknown-workspace');
    if (workspace.tenant_id !== tenant.id) return report(4, 'foreign-tenant-workspace');
    let user;
    try { user = await kcAdmin.getUser(tenant.iam_realm, options.user); }
    catch (error) { if (error.kcStatus === 404) return report(5, 'unknown-user'); throw error; }
    if (!user || user.id !== options.user) return report(5, 'unknown-user');
    if (user.serviceAccountClientId || user.username?.startsWith('service-account-')) return report(6, 'service-account-user');
    const attributes = normalizeKeycloakAttributes(user.attributes ?? {});
    const existing = (attributes.workspace_id ?? []).filter(value => value.trim());
    if (existing.length && (existing.length !== 1 || existing[0] !== workspace.id)) return report(7, 'already-bound-to-different-workspace');
    const changed = existing.length === 0;
    if (changed && !options.dryRun) {
      await kcAdmin.updateUser(tenant.iam_realm, user.id, { attributes: { ...attributes, workspace_id: [workspace.id] } });
    }
    return report(0, options.dryRun ? 'dry-run' : changed ? 'bound' : 'unchanged', {
      userId: user.id, workspaceId: workspace.id,
      message: 'The user needs a new token to use the workspace binding.',
    });
  } catch (error) { return report(9, safeFailure(error)); }
}

async function main() {
  // Validate the single-user CLI before opening a database connection.
  try { parseRebindArgs(process.argv.slice(2)); }
  catch { process.stderr.write('Expected one --tenant, one --user and one --workspace.\n'); process.exitCode = 2; return; }
  // cliMain validates the reconciliation-only flags, so wire this CLI separately.
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });
  try { process.exitCode = (await runRebind({ argv: process.argv.slice(2), pool })).exitCode; }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('Workspace user rebind failed; inspect configuration and provider health.\n'); process.exitCode = 9; });
}
