import { pathToFileURL } from 'node:url';
import { kcAdmin as defaultKcAdmin, isWorkspaceClaimMapper } from '../apps/control-plane/kc-admin.mjs';
import { ROLE, ROLLBACK_MARKER, parseArgs, preflight, cliMain, inspect, isBinding,
  withRegistryLock, requireState, safeFailure, verifyDisabled } from './lib/workspace-service-accounts.mjs';

async function migrate(kc, state) {
  const { realm, uuid, row, user, client, roles } = state;
  if (state.complete && !client.attributes?.[ROLLBACK_MARKER]) return;
  let changed = false;
  let assignmentAttempted = false;
  try {
    if (client.enabled) {
      changed = true; // A failed PUT can still have committed.
      await kc.setClientEnabled(realm, uuid, false);
    }
    await verifyDisabled(kc, state);
    changed = true;
    await kc.ensureWorkspaceIdMapper(realm, uuid, row.joined_workspace_id);
    const bindings = (await kc.listClientMappers(realm, uuid)).filter(isWorkspaceClaimMapper);
    requireState(bindings.length === 1 && isBinding(bindings[0], row.joined_workspace_id), 'workspace-mapper-verification-failed');
    for (const scope of state.detach) {
      if (scope.type === 'default') await kc.removeClientDefaultScope(realm, uuid, scope.id);
      else await kc.removeClientOptionalScope(realm, uuid, scope.id);
    }
    // The client stays disabled throughout claim migration. After detachment the
    // only source is the verified hardcoded W mapper, including optional scopes.
    await kc.inspectWorkspaceClaimSources(realm, uuid, row.joined_workspace_id);
    await verifyDisabled(kc, state);
    if (!roles.includes(ROLE)) {
      await kc.createRealmRole(realm, ROLE);
      assignmentAttempted = true;
      await kc.assignRealmRoles(realm, user.id, [ROLE]);
    }
    const effective = (await kc.listEffectiveRealmRoles(realm, user.id)).map(role => role.name);
    requireState(effective.includes(ROLE) && roles.every(role => effective.includes(role)), 'effective-role-verification-failed');
    if (client.enabled || client.attributes?.[ROLLBACK_MARKER] === row.joined_workspace_id) {
      if (client.attributes?.[ROLLBACK_MARKER]) {
        // Client PUT merges attributes: omission does not clear a key. Remove it
        // explicitly and verify while disabled, before restoring token issuance.
        await kc.setClientEnabled(realm, uuid, false, { ...client.attributes, [ROLLBACK_MARKER]: null });
        const cleared = await kc.getClient(realm, uuid);
        requireState(cleared?.enabled === false && cleared.attributes?.[ROLLBACK_MARKER] == null,
          'rollback-marker-not-cleared');
      }
      await kc.setClientEnabled(realm, uuid, true);
      const enabled = await kc.getClient(realm, uuid);
      requireState(enabled?.enabled === true && enabled.attributes?.[ROLLBACK_MARKER] == null, 'client-enable-verification-failed');
    }
  } catch (error) {
    if (changed) {
      // Disable before removing a newly granted role: role-less enabled SAs can
      // list API keys. Never remove any role that existed before this invocation.
      let disabled = false;
      try {
        await kc.setClientEnabled(realm, uuid, false, client.attributes);
        await verifyDisabled(kc, state);
        disabled = true;
      } catch { /* Preserve binding and role if the disable could not be proved. */ }
      if (disabled && assignmentAttempted) {
        try { await kc.removeRealmRoles(realm, user.id, [ROLE]); }
        catch { /* Still disabled and bound; report failure without widening access. */ }
      }
    }
    throw error;
  }
}

export async function runBackfill({ argv = [], pool, kcAdmin = defaultKcAdmin, outStream = process.stdout } = {}) {
  const { dryRun } = parseArgs(argv);
  const state = await preflight({ pool, kcAdmin });
  if (!dryRun && !state.blocked) {
    for (const item of state.inspected) {
      try {
        await withRegistryLock(pool, item.row, async row => migrate(kcAdmin, await inspect(kcAdmin, row)));
      } catch (error) { state.failed.push({ serviceAccountId: item.row.id, reason: safeFailure(error) }); }
    }
  }
  const result = { mode: dryRun ? 'dry-run' : 'apply', inspected: state.inspected.map(item => item.report), failed: state.failed };
  outStream.write(`${JSON.stringify(result, null, 2)}\n`);
  return { exitCode: result.failed.length ? 1 : 0, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain(runBackfill, process.argv.slice(2)).catch(() => {
    process.stderr.write('Workspace service-account back-fill failed; inspect configuration and provider health.\n');
    process.exitCode = 1;
  });
}
