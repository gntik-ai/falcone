// Separate entry point so rollback cannot be selected accidentally by a back-fill flag.
import { pathToFileURL } from 'node:url';
import { kcAdmin as defaultKcAdmin } from '../apps/control-plane/kc-admin.mjs';
import { markServiceAccountCredentialsInvalidatedAhead } from '../apps/control-plane/tenant-store.mjs';
import { ROLE, ROLLBACK_MARKER, parseArgs, preflight, cliMain, inspect,
  withRegistryLock, requireState, safeFailure, verifyDisabled } from './lib/workspace-service-accounts.mjs';

export async function runRollback({ argv = [], pool, kcAdmin = defaultKcAdmin, outStream = process.stdout,
  skewSec = Number(process.env.SA_REVOCATION_SKEW_SEC ?? 1) } = {}) {
  const { dryRun } = parseArgs(argv);
  requireState(Number.isSafeInteger(skewSec) && skewSec >= 0, 'invalid-revocation-skew');
  const state = await preflight({ pool, kcAdmin, rollback: true });
  // Contain every independently verified bound SA, even if another row cannot be
  // rolled back. Those rows remain untouched and keep the report nonzero.
  if (!dryRun) {
    for (const item of state.inspected) {
      try {
        await withRegistryLock(pool, item.row, async (row, db) => {
          const current = await inspect(kcAdmin, row, { rollback: true });
          const { realm, uuid, client, user, roles } = current;
          // A prior incident/lifecycle disable must survive a forward re-run.
          // Preserve an existing recovery marker, but create one only for a
          // client whose token issuance this invocation is stopping.
          const attributes = client.enabled
            ? { ...client.attributes, [ROLLBACK_MARKER]: row.joined_workspace_id }
            : client.attributes;
          await kcAdmin.setClientEnabled(realm, uuid, false, attributes);
          await verifyDisabled(kcAdmin, current);
          requireState((await kcAdmin.getClient(realm, uuid))?.attributes?.[ROLLBACK_MARKER] === attributes?.[ROLLBACK_MARKER], 'rollback-marker-not-persisted');
          const cutoff = new Date(await markServiceAccountCredentialsInvalidatedAhead(db, row.id, skewSec + 2));
          requireState(Number.isFinite(cutoff.getTime()), 'missing-credential-cutoff');
          if (roles.includes(ROLE)) await kcAdmin.removeRealmRoles(realm, user.id, [ROLE]);
          const effective = (await kcAdmin.listEffectiveRealmRoles(realm, user.id)).map(role => role.name);
          requireState(!effective.includes(ROLE), 'workspace-role-still-inherited');
          requireState(roles.filter(role => role !== ROLE).every(role => effective.includes(role)), 'previous-role-missing');
          await inspect(kcAdmin, row, { rollback: true });
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
