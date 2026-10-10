import { checkPostgresExtensionAvailable } from '../../../../packages/internal-contracts/src/postgres-extension-availability.mjs';
import { clientError, mapPgError } from './errors.mjs';

export const VECTOR_UNAVAILABLE_MESSAGE = 'Vector search is unavailable on this workspace database';
const POSITIVE_TTL_MS = 60_000;
const positiveProbes = new WeakMap(); // registry -> Map(host:port -> expiresAt); no DSNs/credentials

export function vectorCapabilityUnavailable() {
  return Object.assign(clientError(VECTOR_UNAVAILABLE_MESSAGE, 501, 'CAPABILITY_UNAVAILABLE'), {
    capability: 'vector_search',
  });
}

// Only vector-related undefined types/operators qualify. Other SQLSTATEs and
// unrelated undefined objects retain the caller's existing error mapping.
export function vectorCapabilityError(error) {
  if (['42704', '42883'].includes(error?.code) && /\bvector(?:\b|_)/i.test(error?.message ?? '')) {
    return vectorCapabilityUnavailable();
  }
  return undefined;
}

// Probe the borrowed workspace connection, never the platform/bootstrap database.
// Reuse the reprovision catalog query; a failed probe must not permit vector SQL.
export async function requireVectorCapability(registry, client) {
  const { host, port } = client.connectionParameters ?? {};
  // node-postgres supplies these from the resolved connection. Custom clients
  // without connection metadata still probe, but cannot share cached results.
  const key = host && port ? `${host}:${port}` : undefined;
  let cache = positiveProbes.get(registry);
  if (key && (cache?.get(key) ?? 0) > Date.now()) return;
  if (key) cache?.delete(key);
  let available;
  try {
    available = await checkPostgresExtensionAvailable('vector', async (sql, params) => (await client.query(sql, params)).rows);
  } catch (error) {
    throw mapPgError(error);
  }
  if (!available) throw vectorCapabilityUnavailable();
  if (key) {
    if (!cache) {
      cache = new Map();
      positiveProbes.set(registry, cache);
    }
    cache.set(key, Date.now() + POSITIVE_TTL_MS);
  }
}
