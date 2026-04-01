/**
 * Build export artifacts for restore E2E tests via API or DI overrides.
 * @module tests/e2e/fixtures/restore/artifact-builder
 */

import { randomUUID } from 'node:crypto';

const FORMAT_VERSION = '1.0.0';

/**
 * Build the default artifact data for a given tenant seed manifest.
 * This constructs the artifact shape that the export action (T01) would produce.
 *
 * @param {string} tenantId
 * @param {Object} seedManifests - keyed by domain
 * @param {Object} [opts]
 * @param {string[]} [opts.domains] - restrict to these domains
 * @returns {Object}
 */
export function buildArtifactFromManifests(tenantId, seedManifests, opts = {}) {
  const allDomains = opts.domains ?? Object.keys(seedManifests);
  const domains = [];

  for (const dk of allDomains) {
    const manifest = seedManifests[dk];
    if (!manifest || manifest.skipped) {
      domains.push({ domain_key: dk, status: 'not_available', data: null });
      continue;
    }

    domains.push({
      domain_key: dk,
      status: 'ok',
      data: buildDomainData(dk, tenantId, manifest),
    });
  }

  return {
    tenant_id: tenantId,
    format_version: FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    checksum: `sha256:${randomUUID().replace(/-/g, '')}`,
    domains,
  };
}

function buildDomainData(dk, tenantId, manifest) {
  switch (dk) {
    case 'iam':
      return {
        realm: tenantId,
        roles: (manifest.roles ?? []).map(name => ({
          name,
          composites: { realm: [] },
          attributes: {},
        })),
        groups: (manifest.groups ?? []).map(name => ({ name })),
        client_scopes: (manifest.clientScopes ?? []).map(name => ({
          name,
          protocol: 'openid-connect',
        })),
        identity_providers: [],
      };

    case 'postgres_metadata':
      return {
        schema: tenantId.replace(/-/g, '_'),
        schemas: (manifest.schemas ?? []).map(name => ({ name })),
        tables: (manifest.tables ?? []).map(name => ({
          name,
          columns: [
            { column_name: 'id', data_type: 'uuid' },
            { column_name: 'data', data_type: 'jsonb' },
          ],
        })),
        views: (manifest.views ?? []).map(name => ({ name })),
        extensions: [],
        grants: [],
      };

    case 'mongo_metadata':
      return {
        database: tenantId.replace(/-/g, '_'),
        collections: (manifest.collections ?? []).map(name => ({
          name,
          validator: {},
        })),
        indexes: (manifest.indexes ?? []).map(name => ({ name })),
      };

    case 'kafka':
      return {
        topics: (manifest.topics ?? []).map(name => ({
          name,
          numPartitions: 3,
          configEntries: {},
        })),
        acls: [],
        consumer_groups: [],
      };

    case 'functions':
      return {
        namespace: tenantId,
        actions: (manifest.actions ?? []).map(name => ({
          name,
          exec: { kind: 'nodejs:20' },
        })),
        packages: (manifest.packages ?? []).map(name => ({ name })),
        triggers: [],
        rules: [],
      };

    case 'storage':
      return {
        buckets: (manifest.buckets ?? []).map(name => ({
          name,
          versioning: 'Enabled',
        })),
      };

    default:
      return {};
  }
}

/**
 * Build an artifact via the export API (T01).
 *
 * @param {string} tenantId
 * @param {string[]} [domains]
 * @param {import('../../helpers/api-client.mjs').ApiClient} client
 * @returns {Promise<Object>}
 */
export async function buildArtifact(tenantId, domains, client) {
  const body = domains ? { domains } : {};
  const res = await client.post(`/v1/admin/tenants/${tenantId}/config/export`, body);
  if (res.status >= 400) {
    throw new Error(`Export failed for ${tenantId}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Build a degraded artifact with one domain marked as not_available.
 *
 * @param {Object} artifact - original artifact
 * @param {string} degradedDomain - domain key to degrade
 * @returns {Object} - copy of artifact with degraded domain
 */
export function buildDegradedArtifact(artifact, degradedDomain) {
  const copy = JSON.parse(JSON.stringify(artifact));
  const domain = copy.domains.find(d => d.domain_key === degradedDomain);
  if (domain) {
    domain.status = 'not_available';
    domain.data = null;
  } else {
    copy.domains.push({ domain_key: degradedDomain, status: 'not_available', data: null });
  }
  return copy;
}

/**
 * Build a large artifact approaching max size for EC4.
 *
 * @param {Object} baseArtifact
 * @param {number} [approxBytes=9437184] ~9MB
 * @returns {Object}
 */
export function buildLargeArtifact(baseArtifact, approxBytes = 9 * 1024 * 1024) {
  const copy = JSON.parse(JSON.stringify(baseArtifact));
  const currentSize = JSON.stringify(copy).length;
  const padding = approxBytes - currentSize;
  if (padding > 0) {
    // Add padding as extra metadata that won't affect domain processing
    copy._padding = 'x'.repeat(padding);
  }
  return copy;
}
