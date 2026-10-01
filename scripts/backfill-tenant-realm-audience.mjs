// #980: reconcile tenant-app audiences BEFORE enabling enforcement in staging/prod.
// Dry-run by default. Uses the existing kc-admin Secret-backed environment; never logs
// credentials or upstream error bodies. Run only in the operator's announced window.
import { pathToFileURL } from 'node:url';
import {
  kcAdmin as defaultKcAdmin,
  TENANT_AUDIENCE_MAPPER_NAME,
  isTenantAudienceMapper,
  tenantDataApiAudience,
} from '../apps/control-plane/kc-admin.mjs';

export function parseBackfillArgs(argv = []) {
  const flags = { dryRun: true };
  for (const arg of argv) {
    if (arg === '--apply') flags.dryRun = false;
    else if (arg === '--dry-run') flags.dryRun = true;
    else throw new Error('unsupported reconciliation option');
  }
  return flags;
}

export async function inspectRealm(kcAdmin, realm, audience) {
  const clients = (await kcAdmin.listClients(realm))
    .filter((client) => client.attributes?.['in-falcone.kind'] === 'tenant-app');
  if (!clients.length) throw new Error('tenant-app client missing');
  const missing = [];
  for (const client of clients) {
    const mappers = await kcAdmin.listClientMappers(realm, client.id);
    const named = mappers.filter((mapper) => mapper.name === TENANT_AUDIENCE_MAPPER_NAME);
    if (!named.length) missing.push({ id: client.id, clientId: client.clientId });
    else if (named.length !== 1 || !isTenantAudienceMapper(named[0], audience)) {
      throw new Error('tenant audience mapper configuration mismatch');
    }
  }
  return { realm, missing };
}

export async function runBackfill({
  argv = [], loadTenantRealms, kcAdmin = defaultKcAdmin,
  audience = tenantDataApiAudience(), outStream = process.stdout,
} = {}) {
  tenantDataApiAudience({ KEYCLOAK_TENANT_AUDIENCE: audience });
  const { dryRun } = parseBackfillArgs(argv);
  const realms = [...new Set(await loadTenantRealms())];
  const inspected = [];
  const repaired = [];
  const failed = [];
  for (const realm of realms) {
    let phase = 'inspect';
    try {
      const state = await inspectRealm(kcAdmin, realm, audience);
      inspected.push(state);
      if (!dryRun) {
        phase = 'repair';
        for (const client of state.missing) {
          const { created } = await kcAdmin.ensureTenantAudienceMapper(realm, client.id, audience);
          if (created) repaired.push({ realm, clientId: client.clientId });
        }
      }
    } catch {
      // Do not persist raw Keycloak responses or errors: they can contain OAuth material.
      failed.push({ realm, phase });
    }
  }
  const result = {
    mode: dryRun ? 'dry-run' : 'apply', audience,
    counts: {
      realms: realms.length, needingWork: inspected.filter((state) => state.missing.length).length,
      repaired: repaired.length, failed: failed.length,
    },
    inspected, repaired, failed,
  };
  outStream.write(`${JSON.stringify(result, null, 2)}\n`);
  return { exitCode: failed.length ? 1 : 0, result };
}

async function main() {
  // Validate CLI/config before connecting; database and admin credentials come from env only.
  parseBackfillArgs(process.argv.slice(2));
  const audience = tenantDataApiAudience();
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });
  try {
    const loadTenantRealms = async () => {
      const { rows } = await pool.query('SELECT DISTINCT iam_realm FROM tenants WHERE iam_realm IS NOT NULL ORDER BY iam_realm');
      return rows.map((row) => row.iam_realm);
    };
    const { exitCode } = await runBackfill({ argv: process.argv.slice(2), audience, loadTenantRealms });
    process.exitCode = exitCode;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Tenant audience reconciliation failed; inspect configuration and provider health.\n');
    process.exitCode = 1;
  });
}
