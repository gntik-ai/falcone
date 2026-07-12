/**
 * @module seaweedfs-s3-identities-config
 *
 * PURE, deterministic builders for the SeaweedFS S3 `identities` document the
 * deployment loads (chart Secret `seaweedfs_s3_config`, key consumed by the S3
 * gateway via `-s3.config`), plus the tenant/workspace bucket-namespacing rule.
 *
 * Change add-seaweedfs-per-tenant-identities (#553, epic #540). The live
 * 2026-06-18 campaign (audit/live-campaign/evidence/22-storage-s3.md) proved the
 * cardinal cross-tenant breach at the object-storage layer:
 *   - the chart issued ONE shared root identity (`falcone-s3-admin`) carrying a
 *     GLOBAL grant `["Admin","Read","Write","List","Tagging"]` (no `:bucket`
 *     suffix), so whoever holds the keys lists/reads/writes EVERY tenant's bucket
 *     directly over the S3 gateway (cross-tenant read AND write proven);
 *   - buckets were created with the RAW resourceId, with no tenant/workspace
 *     prefix, so there is no S3-level namespace boundary (defense-in-depth gap).
 *
 * This module is the chart-facing counterpart of the runtime IAM client
 * (`seaweedfs-iam-client.mjs`, which onboards per-workspace identities live). It
 * builds the SAME canonical, fail-closed, per-bucket-scoped identity shape so the
 * bootstrap (chart-loaded) document already grants NO global skeleton key:
 *   - every action is expanded to `Action:bucket` (never a bare global action);
 *   - the platform admin identity is confined to a reserved platform-bucket
 *     prefix, NOT a wildcard — it cannot read/write any tenant bucket;
 *   - each workspace identity is scoped ONLY to its own namespaced bucket.
 *
 * No I/O. No SDK. Reuses `buildSeaweedFSIdentity` so the bootstrap document and
 * live-onboarded identities share one validation + scoping code path.
 */

import { createHash } from 'node:crypto';

import {
  buildSeaweedFSIdentity,
  SEAWEEDFS_IAM_ERROR_CODES,
} from './seaweedfs-iam-client.mjs';

export const SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY_SCOPE: SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
  MISSING_ADMIN_CREDENTIAL: 'MISSING_ADMIN_CREDENTIAL',
});

/** Default platform admin identity name (matches chart `seaweedfsS3Creds.identityName`). */
export const DEFAULT_ADMIN_IDENTITY_NAME = 'falcone-s3-admin';

/**
 * Reserved DNS-safe prefix for platform-managed buckets. The shared admin
 * identity is scoped to this prefix ONLY, so it can manage platform state but is
 * NOT a cross-tenant skeleton key over `t-…` tenant buckets.
 */
export const PLATFORM_RESERVED_BUCKET_PREFIX = 'falcone-platform-';

/** Default reserved platform bucket the admin identity owns. */
export const DEFAULT_PLATFORM_BUCKET = `${PLATFORM_RESERVED_BUCKET_PREFIX}system`;

/** Bucket-name DNS contract (mirrors utils/bucket-name-validator + storage-handlers). */
const BUCKET_NAME_MAX_LENGTH = 63;
const BUCKET_NAME_MIN_LENGTH = 3;
const TENANT_NS_HASH_LENGTH = 8;
const WORKSPACE_NS_HASH_LENGTH = 8;

function configError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw configError(
      SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES.INVALID_IDENTITY_SCOPE,
      `${field} is required.`,
    );
  }
  return value.trim();
}

function shortHash(seed, length) {
  return createHash('sha256').update(String(seed)).digest('hex').slice(0, length);
}

function sanitizeFragment(raw, fallback) {
  const cleaned = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

/**
 * Derive the canonical, DNS-safe, tenant/workspace-namespaced bucket name.
 *
 * Shape: `t-<tenantSlugHash>-<workspaceSlugHash>` — the `t-<tenantId-derived>`
 * prefix matches the legacy tenant-prefix discovery filter in the s3-collector
 * and guarantees two distinct tenants/workspaces can NEVER collapse to the same
 * S3 bucket name (the hash carries the full tenantId/workspaceId entropy). The
 * optional slug hints make the name human-recognizable without weakening the
 * isolation guarantee.
 *
 * @param {{tenantId:string, workspaceId:string, workspaceSlug?:string, tenantSlug?:string}} input
 * @returns {string} DNS-safe bucket name (`[a-z0-9-]{3,63}`)
 */
export function deriveWorkspaceBucketName(input = {}) {
  const tenantId = assertNonEmptyString(input.tenantId, 'tenantId');
  const workspaceId = assertNonEmptyString(input.workspaceId, 'workspaceId');

  const tenantHash = shortHash(`tenant:${tenantId}`, TENANT_NS_HASH_LENGTH);
  const workspaceHash = shortHash(`workspace:${tenantId}:${workspaceId}`, WORKSPACE_NS_HASH_LENGTH);
  const wsSlug = sanitizeFragment(input.workspaceSlug, '').slice(0, 16);

  // `t-<tenantHash>-<workspaceHash>[-<wsSlug>]`, hard-trimmed to the DNS bound.
  let name = `t-${tenantHash}-${workspaceHash}`;
  if (wsSlug) {
    name = `${name}-${wsSlug}`.slice(0, BUCKET_NAME_MAX_LENGTH).replace(/-+$/g, '');
  }
  if (name.length < BUCKET_NAME_MIN_LENGTH) {
    name = `t-${tenantHash}-${workspaceHash}`;
  }
  return name;
}

/**
 * Build a single bucket-scoped SeaweedFS identity record (delegates scoping +
 * fail-closed validation to `buildSeaweedFSIdentity`, so an empty/wildcard bucket
 * or an actionless grant throws INVALID_IDENTITY_SCOPE before any document is
 * produced — a global skeleton key can never be reintroduced).
 */
function scopedIdentity({ name, accessKey, secretKey, buckets, actions }) {
  return buildSeaweedFSIdentity({ name, accessKey, secretKey, buckets, actions });
}

/**
 * Build the SeaweedFS `identities` document the chart loads.
 *
 * The admin identity is scoped to the reserved platform-bucket prefix ONLY (no
 * tenant bucket, no wildcard). Each workspace identity is scoped to its own
 * namespaced bucket. Every emitted action is `Action:bucket` — the document
 * contains NO global/wildcard grant, closing the live cross-tenant breach.
 *
 * @param {{
 *   adminIdentityName?: string,
 *   adminAccessKey: string,
 *   adminSecretKey: string,
 *   platformBuckets?: string[],
 *   adminActions?: string[],
 *   workspaceIdentities?: Array<{
 *     workspaceId: string, tenantId?: string, bucketName: string,
 *     accessKey: string, secretKey: string, actions?: string[]
 *   }>
 * }} input
 * @returns {{identities: Array<{name:string, credentials:Array, actions:string[]}>}}
 */
export function buildSeaweedFSIdentitiesConfig(input = {}) {
  const adminAccessKey = input.adminAccessKey;
  const adminSecretKey = input.adminSecretKey;
  if (!adminAccessKey || !adminSecretKey) {
    throw configError(
      SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES.MISSING_ADMIN_CREDENTIAL,
      'adminAccessKey and adminSecretKey are required to build the SeaweedFS identities config.',
    );
  }

  const adminName = (input.adminIdentityName ?? DEFAULT_ADMIN_IDENTITY_NAME).trim() || DEFAULT_ADMIN_IDENTITY_NAME;
  const platformBuckets = Array.isArray(input.platformBuckets) && input.platformBuckets.length > 0
    ? input.platformBuckets.map((bucket) => assertNonEmptyString(bucket, 'platformBuckets[]'))
    : [DEFAULT_PLATFORM_BUCKET];

  // Every platform bucket MUST sit under the reserved prefix so the admin grant
  // can never address a tenant `t-…` bucket.
  for (const bucket of platformBuckets) {
    if (!bucket.startsWith(PLATFORM_RESERVED_BUCKET_PREFIX)) {
      throw configError(
        SEAWEEDFS_IDENTITIES_CONFIG_ERROR_CODES.INVALID_IDENTITY_SCOPE,
        `Admin identity bucket '${bucket}' must sit under the reserved platform prefix '${PLATFORM_RESERVED_BUCKET_PREFIX}'.`,
      );
    }
  }

  const adminActions = Array.isArray(input.adminActions) && input.adminActions.length > 0
    ? input.adminActions
    : ['Admin', 'Read', 'Write', 'List', 'Tagging'];

  const identities = [
    scopedIdentity({
      name: adminName,
      accessKey: adminAccessKey,
      secretKey: adminSecretKey,
      buckets: platformBuckets,
      actions: adminActions,
    }),
  ];

  for (const ws of input.workspaceIdentities ?? []) {
    const workspaceId = assertNonEmptyString(ws.workspaceId, 'workspaceIdentities[].workspaceId');
    identities.push(scopedIdentity({
      name: ws.identityName ?? `falcone-ws-${workspaceId}`,
      accessKey: ws.accessKey,
      secretKey: ws.secretKey,
      buckets: [ws.bucketName],
      actions: Array.isArray(ws.actions) && ws.actions.length > 0 ? ws.actions : ['Read', 'Write', 'List'],
    }));
  }

  return { identities };
}
