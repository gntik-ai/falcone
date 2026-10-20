// Separate entry point so rollback cannot be selected accidentally by a back-fill flag.
import { pathToFileURL } from 'node:url';
import { kcAdmin as defaultKcAdmin } from '../apps/control-plane/kc-admin.mjs';
import { markServiceAccountCredentialsInvalidatedUntil } from '../apps/control-plane/tenant-store.mjs';
import { ROLE, ROLLBACK_MARKER, parseArgs, preflight, cliMain, inspect,
  withRegistryLock, requireState, safeFailure, verifyDisabled } from './lib/workspace-service-accounts.mjs';

export async function runRollback({ argv = [], pool, kcAdmin = defaultKcAdmin, outStream = process.stdout,
  now = () => Date.now(), skewSec = Number(process.env.SA_REVOCATION_SKEW_SEC ?? 1) } = {}) {
  const { dryRun } = parseArgs(argv);
  requireState(Number.isSafeInteger(skewSec) && skewSec >= 0, 'invalid-revocation-skew');
  const state = await preflight({ pool, kcAdmin, rollback: true });
  if (!dryRun && state.failed.length === 0) {
    for (const item of state.inspected) {
      try {
        await withRegistryLock(pool, item.row, async (row, db) => {
          const current = await inspect(kcAdmin, row, { rollback: true });
          const { realm, uuid, client, user, roles } = current;
          await kcAdmin.setClientEnabled(realm, uuid, false, { ...client.attributes, [ROLLBACK_MARKER]: row.joined_workspace_id });
          await verifyDisabled(kcAdmin, current);
          requireState((await kcAdmin.getClient(realm, uuid))?.attributes?.[ROLLBACK_MARKER] === row.joined_workspace_id, 'rollback-marker-not-persisted');
          const cutoff = new Date(now() + (skewSec + 2) * 1000);
          await markServiceAccountCredentialsInvalidatedUntil(db, row.id, cutoff);
          if (roles.includes(ROLE)) await kcAdmin.removeRealmRoles(realm, user.id, [ROLE]);
          const effective = (await kcAdmin.listEffectiveRealmRoles(realm, user.id)).map(role => role.name);
          requireState(!effective.includes(ROLE), 'workspace-role-still-inherited');
          requireState(roles.filter(role => role !== ROLE).every(role => effective.includes(role)), 'previous-role-missing');
          await kcAdmin.inspectWorkspaceClaimSources(realm, uuid, row.joined_workspace_id);
          await verifyDisabled(kcAdmin, current);
          item.report.cutoff = cutoff.toISOString();
        });
      } catch (error) { state.failed.push({ serviceAccountId: item.row.id, reason: safeFailure(error) }); }
    }
  }
  const result = { mode: dryRun ? 'dry-run' : 'apply', inspected: state.inspected.map(item => item.report), failed: state.failed };
  outStream.write(`${JSON.stringify(result, null, 2)}\n`);
  return { exitCode: result.failed.length ? 1 : 0, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain(runRollback, process.argv.slice(2)).catch(() => {
    process.stderr.write('Workspace service-account rollback failed; inspect configuration and provider health.\n');
    process.exitCode = 1;
  });
}
