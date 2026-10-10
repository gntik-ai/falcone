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

// Match missing pgvector objects, not a vector token in an arbitrary tenant
// identifier (for example a missing index named "vector_idx").
const MISSING_VECTOR_OBJECT = [
  /^type "(?:[a-z_][a-z0-9_]*\.)?vector(?:\[\])?" does not exist$/i,
  /^operator does not exist:.*\s(?:[a-z_][a-z0-9_]*\.)?vector(?:\[\])?(?=\s|$)/i,
  /^operator class "(?:[a-z_][a-z0-9_]*\.)?vector_[a-z0-9_]+_ops" does not exist(?: for access method "[^"]+")?$/i,
  /^function (?:[a-z_][a-z0-9_]*\.)?vector_[a-z0-9_]+\([^)]*\) does not exist$/i,
  /^access method "(?:hnsw|ivfflat)" does not exist$/i,
];

// Other SQLSTATEs and unrelated undefined objects keep the existing mapping.
export function vectorCapabilityError(error) {
  if (['42704', '42883'].includes(error?.code) && MISSING_VECTOR_OBJECT.some((pattern) => pattern.test(error?.message ?? ''))) {
    return vectorCapabilityUnavailable();
  }
  return undefined;
}

// Callers with raw SQL errors supply mapPgError; outer catches and mapping
// writes preserve their existing classified errors when the backstop does not apply.
export function mapVectorRouteError(error, vectorRequest, fallback = (cause) => cause) {
  return (vectorRequest && vectorCapabilityError(error)) || fallback(error);
}

// Probe the borrowed connection selected by the existing workspace resolver.
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
