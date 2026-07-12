/**
 * SeaweedFS lifecycle/policy/CORS/versioning compatibility gate.
 *
 * For each declared config type, consult the adr-spike compatibility matrix for
 * the deployed SeaweedFS version and either apply it, apply a supported subset
 * (PARTIAL, recording omitted fields / the chosen shim), or skip it (UNSUPPORTED,
 * recording the reason). Every decision yields exactly one gap-log entry so no
 * declared configuration is silently lost.
 *
 * @module reconcilers/compat-gate
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Order in which config types are evaluated/logged. */
export const CONFIG_TYPES = Object.freeze(['lifecycle', 'policy', 'cors', 'versioning']);

/** Map each config type to the applier method on the SeaweedFS client. */
export const APPLIER_METHODS = Object.freeze({
  lifecycle: 'putBucketLifecycleConfiguration',
  policy: 'putBucketPolicy',
  cors: 'putBucketCors',
  versioning: 'putBucketVersioning',
});

/** The default matrix shipped with the service (loaded from JSON at import time). */
export const DEFAULT_COMPAT_MATRIX = JSON.parse(
  readFileSync(fileURLToPath(new URL('../config/seaweedfs-compat-matrix.json', import.meta.url)), 'utf8'),
);

/**
 * Resolve SUPPORTED / PARTIAL / UNSUPPORTED for a (version, configType). Falls
 * back to the matrix's defaultVersion, then to UNSUPPORTED (fail-closed).
 *
 * @param {object} matrix
 * @param {string} version
 * @param {string} configType
 * @returns {('SUPPORTED'|'PARTIAL'|'UNSUPPORTED')}
 */
export function resolveSupport(matrix, version, configType) {
  const byVersion = matrix.versions?.[version] ?? matrix.versions?.[matrix.defaultVersion] ?? {};
  return byVersion[configType] ?? 'UNSUPPORTED';
}

/**
 * G1 shim: SeaweedFS rejects the canonical `Principal: {AWS: [...]}` object form.
 * Flatten it to the accepted string form — `"*"` for a wildcard, or the bare
 * identity-name(s) for a scoped grant (preserving the owning identity so the
 * policy still restricts access). Returns the rewritten policy plus the JSON
 * paths that were rewritten.
 *
 * @param {object} policy
 * @returns {{ policy: object, rewrittenPaths: string[] }}
 */
export function normalizeSeaweedfsPolicyPrincipal(policy) {
  const rewrittenPaths = [];
  const clone = structuredClone(policy);
  const statements = Array.isArray(clone?.Statement)
    ? clone.Statement
    : clone?.Statement
      ? [clone.Statement]
      : [];
  statements.forEach((stmt, i) => {
    if (stmt && typeof stmt.Principal === 'object' && stmt.Principal !== null && 'AWS' in stmt.Principal) {
      const aws = stmt.Principal.AWS;
      const list = Array.isArray(aws) ? aws : [aws];
      if (list.length === 1 && list[0] === '*') stmt.Principal = '*';
      else if (list.length === 1) stmt.Principal = list[0];
      else stmt.Principal = list;
      rewrittenPaths.push(`Statement[${i}].Principal.AWS`);
    }
  });
  return { policy: clone, rewrittenPaths };
}

/**
 * Compute the PARTIAL-supported subset of a config payload plus the omitted/
 * rewritten fields. Policy uses the G1 principal shim; lifecycle drops
 * unsupported `Filter`/`Transitions` predicates; other types pass through.
 *
 * @param {string} configType
 * @param {*} value
 * @returns {{ payload: *, omittedFields: string[], shim: string|null }}
 */
export function partialSubset(configType, value) {
  if (configType === 'policy') {
    const { policy, rewrittenPaths } = normalizeSeaweedfsPolicyPrincipal(value);
    return { payload: policy, omittedFields: rewrittenPaths, shim: 'principal-aws-to-wildcard' };
  }
  if (configType === 'lifecycle') {
    const clone = structuredClone(value);
    const omittedFields = [];
    const rules = Array.isArray(clone?.Rules) ? clone.Rules : [];
    rules.forEach((rule, i) => {
      for (const field of ['Filter', 'Transitions']) {
        if (rule && field in rule) {
          delete rule[field];
          omittedFields.push(`Rules[${i}].${field}`);
        }
      }
    });
    return { payload: clone, omittedFields, shim: 'lifecycle-filter-subset' };
  }
  // No known partial transform — apply as-is but flag that nothing was stripped.
  return { payload: value, omittedFields: [], shim: null };
}

/**
 * Apply a workspace bucket's declared config (lifecycle/policy/CORS/versioning)
 * to SeaweedFS through the compatibility gate. Writes one gap-log entry per
 * DECLARED config type. In dryRun mode no backend write is issued, but the same
 * decisions are recorded and returned as planned actions.
 *
 * @param {string} bucketName
 * @param {{ lifecycle?: *, policy?: *, cors?: *, versioning?: * }} config
 * @param {string} seaweedfsVersion
 * @param {object} seaweedfsClient - exposes the APPLIER_METHODS
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {object} [opts.matrix=DEFAULT_COMPAT_MATRIX]
 * @param {import('./gap-logger.mjs').GapLogger} [opts.gapLogger]
 * @returns {Promise<{ entries: object[], plannedActions: object[] }>}
 */
export async function applyBucketConfig(bucketName, config = {}, seaweedfsVersion, seaweedfsClient, opts = {}) {
  const { dryRun = false, matrix = DEFAULT_COMPAT_MATRIX, gapLogger = null } = opts;
  const entries = [];
  const plannedActions = [];

  for (const configType of CONFIG_TYPES) {
    const value = config?.[configType];
    if (value === undefined || value === null) continue; // only DECLARED settings

    const support = resolveSupport(matrix, seaweedfsVersion, configType);
    const method = APPLIER_METHODS[configType];
    /** @type {import('./gap-logger.mjs').GapEntry} */
    let entry;
    let payload = value;

    if (support === 'SUPPORTED') {
      entry = { bucketName, configType, seaweedfsVersion, decision: 'applied' };
    } else if (support === 'PARTIAL') {
      const subset = partialSubset(configType, value);
      payload = subset.payload;
      entry = {
        bucketName,
        configType,
        seaweedfsVersion,
        decision: 'partial',
        omittedFields: subset.omittedFields,
        ...(subset.shim ? { shim: subset.shim } : {}),
      };
    } else {
      entry = {
        bucketName,
        configType,
        seaweedfsVersion,
        decision: 'drop',
        reason: `${configType} is UNSUPPORTED on SeaweedFS ${seaweedfsVersion}`,
      };
    }

    if (entry.decision !== 'drop') {
      plannedActions.push({ type: 'config', bucketName, configType, method, decision: entry.decision });
      if (!dryRun) {
        await seaweedfsClient[method](bucketName, payload);
      }
    }

    entries.push(entry);
    if (gapLogger) gapLogger.record(entry);
  }

  return { entries, plannedActions };
}
