// Run inside the control-plane runtime with its normal scoped identity. No values are printed.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { withFunctionSecretLock } from './function-secret-lock.mjs';
import { normalizeFunctionSecretRefs, functionSecretRefs } from './function-secret-refs.mjs';
import { deployKnativeService, remediateFunctionSecrets, pruneInlineFunctionRevisions } from './function-executor.mjs';
import { getSharedVaultStore } from './vault-secrets.mjs';
import { withPostgresSsl } from './transport-security.mjs';
import * as store from './tenant-store.mjs';

export function runFunctionSecretRemediation(options) {
  return withFunctionSecretLock(options.pool, options.tenantId, options.workspaceId,
    (pool) => remediate({ ...options, pool }));
}

async function remediate({ pool, tenantId, workspaceId, resourceId, refs, apply = false, request, vault = getSharedVaultStore() }) {
  const row = await store.getFnAction(pool, resourceId, tenantId);
  if (!row || row.workspace_id !== workspaceId) throw new Error('Function scope mismatch');
  const options = { tenantId, workspaceId, functionResourceId: resourceId, request };
  const report = await remediateFunctionSecrets(row.ksvc_name, row.source_code, options);
  if (!apply) return report;
  const declared = normalizeFunctionSecretRefs(refs ?? functionSecretRefs(row));
  const envNames = new Set(declared.map((ref) => ref.env));
  const unmapped = [...new Set(report.affected.flatMap((item) => item.envNames))].filter((env) => !envNames.has(env));
  if (unmapped.length) return { ...report, code: 'FN_REMEDIATION_REFS_REQUIRED', unmapped };
  if (declared.length && !vault) throw new Error('Workspace secret backend unavailable');
  const secretEnv = declared.length ? await vault.resolveEnv(tenantId, workspaceId, declared) : [];
  if (secretEnv.length !== declared.length) throw new Error('Declared workspace secrets must exist before remediation');
  await deployKnativeService(row.ksvc_name, row.source_code, {
    ...options, secretEnv, secretRefs: declared, rotateSecrets: true, memoryMb: row.memory_mb, timeoutMs: row.timeout_ms,
  });
  // Persist names before pruning: a pending controller/GC reconciliation remains retryable
  // through the normal secret and Function lifecycle APIs, even after this process exits.
  await store.upsertFnAction(pool, { resourceId, tenantId, workspaceId, actionName: row.action_name,
    runtime: row.runtime, entrypoint: row.entrypoint, sourceCode: row.source_code, parameters: row.parameters,
    memoryMb: row.memory_mb, timeoutMs: row.timeout_ms, ksvcName: row.ksvc_name, createdBy: row.created_by, secretRefs: declared });
  const cleanup = await pruneInlineFunctionRevisions(row.ksvc_name, options);
  return { dryRun: false, affected: report.affected, pending: cleanup.pending };
}

async function main() {
  const { values } = parseArgs({ options: {
    'tenant-id': { type: 'string' }, 'workspace-id': { type: 'string' }, 'resource-id': { type: 'string' },
    refs: { type: 'string' }, apply: { type: 'boolean', default: false },
  } });
  if (!values['tenant-id'] || !values['workspace-id'] || !values['resource-id']) throw new Error('Explicit Function scope required');
  const { Pool } = await import('pg');
  const pool = new Pool(withPostgresSsl({ ...(process.env.DB_URL ? { connectionString: process.env.DB_URL } : {}), max: 1 }));
  try {
    const refs = values.refs ? JSON.parse(await readFile(values.refs, 'utf8')) : undefined;
    const report = await runFunctionSecretRemediation({ pool, tenantId: values['tenant-id'], workspaceId: values['workspace-id'], resourceId: values['resource-id'], refs, apply: values.apply });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (values.apply && (report.code || report.pending.length)) process.exitCode = 2;
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Function secret remediation failed; no secret values are included in this diagnostic.\n');
    process.exitCode = 1;
  });
}
