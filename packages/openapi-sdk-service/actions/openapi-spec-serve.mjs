import pg from 'pg';
import { Kafka } from 'kafkajs';
import { config } from '../src/config.mjs';
import { getCurrentSpec } from '../src/spec-version-repo.mjs';
import { etagFromHash, isEtagMatch } from '../src/spec-cache.mjs';
import { emitSpecAccessed } from '../src/spec-audit.mjs';

const requestBuckets = new Map();

export function extractWorkspaceId(pathname = '') {
  const match = pathname.match(/\/v1\/workspaces\/([^/]+)\/openapi/);
  return match?.[1] ?? null;
}

export function consumeRateLimit(workspaceId, limit, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const current = requestBuckets.get(workspaceId);
  if (!current || current.minute !== minute) {
    requestBuckets.set(workspaceId, { minute, count: 1 });
    return false;
  }
  if (current.count >= limit) return true;
  current.count += 1;
  return false;
}

export async function main(params, dependencies = {}) {
  const workspaceId = extractWorkspaceId(params.__ow_path);
  const headers = params.__ow_headers ?? {};
  const tenantId = headers['x-auth-tenant-id'] ?? headers['x-tenant-id'];
  const requesterId = headers['x-auth-user-id'] ?? headers['x-actor-id'];

  if (!tenantId || !requesterId) {
    return { statusCode: 401, body: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
  }

  if (!workspaceId) {
    return { statusCode: 400, body: { code: 'INVALID_PATH', message: 'workspaceId missing from path' } };
  }

  if (consumeRateLimit(workspaceId, dependencies.rateLimit ?? config.specRateLimitPerMinute, dependencies.now ?? Date.now())) {
    return { statusCode: 429, headers: { 'Retry-After': '60' }, body: { code: 'RATE_LIMITED', message: 'Too many requests' } };
  }

  const pool = dependencies.pool ?? new pg.Pool({ connectionString: config.pgConnectionString });
  const kafka = dependencies.kafka ?? new Kafka({ brokers: config.kafkaBrokers, clientId: config.kafkaClientId });
  const spec = await getCurrentSpec(pool, workspaceId);

  if (!spec) {
    return { statusCode: 404, body: { code: 'SPEC_NOT_FOUND', message: 'No OpenAPI spec available for workspace' } };
  }

  if (spec.tenantId !== tenantId) {
    return { statusCode: 403, body: { code: 'FORBIDDEN', message: 'Workspace tenant mismatch' } };
  }

  if (isEtagMatch(headers['if-none-match'], spec.contentHash)) {
    return { statusCode: 304, headers: { ETag: etagFromHash(spec.contentHash) } };
  }

  const format = params.__ow_query?.format === 'yaml' || headers.accept === 'application/x-yaml' ? 'yaml' : 'json';
  void emitSpecAccessed(kafka, { workspaceId, tenantId, specVersion: spec.specVersion, requesterId, format }).catch(() => undefined);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': format === 'yaml' ? 'application/x-yaml' : 'application/json',
      ETag: etagFromHash(spec.contentHash),
      'X-Spec-Version': spec.specVersion,
      'Cache-Control': 'max-age=60, must-revalidate'
    },
    body: format === 'yaml' ? spec.formatYaml : spec.formatJson
  };
}
