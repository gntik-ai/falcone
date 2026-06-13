/**
 * Per-tenant MCP server registry + supply-chain controls
 * (change: add-mcp-registry-supply-chain, #396; epic #386; ADR-12, ADR-2, ADR-4).
 *
 * Pure, deterministic core that defends against MCP's "rug-pull" risk:
 *   - registerVersion: a server version is pinned by an IMMUTABLE digest (tag alone is refused) and
 *     carries its curated manifest (#393) + source (instant/custom/official) + signature verdict;
 *     entries are keyed by (tenantId, serverId) and accessors NEVER cross tenants (ADR-2).
 *   - diffVersions: surfaces tool-facing changes (added/removed tools, changed description/scope) so
 *     a silent behavior change on a version bump is visible.
 *   - activateVersion: a version with tool-facing changes is `requiresReview` and CANNOT serve until
 *     a tenant approves it; rollbackToVersion re-activates an already-approved prior version.
 *   - verifyImageForDeploy: the deploy-time supply-chain gate (pinned + allowed registry + verified
 *     signature), mirroring scripts/lib/quality-gates.mjs image rules and reusing #394's parsing.
 *
 * No I/O: the actual signature check is an injected verdict (cosign adapter, ADR-4) — this module
 * RECORDS and ENFORCES it, it does not shell out.
 */

import { parseImageRef, isPinnedImage } from './mcp-custom-hosting.mjs';

const SOURCES = new Set(['instant', 'custom', 'official']);

const violation = (code, message, field) => ({ code, severity: 'error', message, field });

/** A fresh empty registry. */
export function createRegistry() {
  return { servers: {} }; // keyed by `${tenantId}::${serverId}`
}

const key = (tenantId, serverId) => `${tenantId}::${serverId}`;

/** Normalize a tool to its agent-visible contract (name, description, scope). */
function toolContract(t = {}) {
  return { name: t.name, description: t.description ?? null, scope: t.scope ?? t.suggestedScope ?? null, mutates: !!t.mutates };
}

/**
 * Register a new server version. Requires a digest-pinned image (a mutable tag alone is refused).
 * Mutates `reg` and returns { ok, version?, violations }.
 * @param {object} reg
 * @param {{tenantId:string, serverId:string, version:string, image:string, manifest?:object, source?:string, signatureVerified?:boolean}} input
 */
export function registerVersion(reg, { tenantId, serverId, version, image, manifest = {}, source, signatureVerified = false } = {}) {
  const violations = [];
  if (!tenantId) violations.push(violation('missing_tenant', 'tenantId is required.', 'tenantId'));
  if (!serverId) violations.push(violation('missing_server_id', 'serverId is required.', 'serverId'));
  if (!version) violations.push(violation('missing_version', 'version is required.', 'version'));
  if (!image) violations.push(violation('missing_image', 'A container image is required.', 'image'));
  if (source && !SOURCES.has(source)) violations.push(violation('invalid_source', `source must be one of ${[...SOURCES].join('/')}.`, 'source'));

  if (image) {
    const { digest } = parseImageRef(image);
    if (!digest) {
      // The registry pins by digest — a tag alone is rug-pull-able.
      violations.push(violation('version_not_digest_pinned', 'A registered version must pin the image by an immutable digest (image@sha256:...).', 'image'));
    } else if (!digest.startsWith('sha256:')) {
      violations.push(violation('invalid_digest', 'Image digest must use sha256:... format.', 'image'));
    }
  }
  if (violations.length > 0) return { ok: false, violations };

  const k = key(tenantId, serverId);
  const entry = reg.servers[k] ?? (reg.servers[k] = { tenantId, serverId, versions: [], activeVersion: null });
  if (entry.versions.some((v) => v.version === version)) {
    return { ok: false, violations: [violation('duplicate_version', `Version "${version}" already exists for this server.`, 'version')] };
  }
  const { digest } = parseImageRef(image);
  const record = {
    version,
    image,
    digest,
    source: source ?? null,
    tools: (manifest.tools ?? []).map(toolContract),
    signatureVerified: !!signatureVerified,
    requiresReview: false, // resolved against the active version below
    approved: false,
    active: false,
  };
  // A version that changes the agent-visible contract vs the active one needs review before serving.
  const active = entry.versions.find((v) => v.version === entry.activeVersion);
  if (active) {
    const { requiresReview } = diffVersions(active, record);
    record.requiresReview = requiresReview;
  }
  // The very first version has no predecessor to drift from — it is approvable as the baseline.
  entry.versions.push(record);
  return { ok: true, version: record, violations: [] };
}

/** Tenant-scoped read: the server entry, or null if it is not this tenant's. */
export function getServer(reg, tenantId, serverId) {
  const entry = reg?.servers?.[key(tenantId, serverId)];
  if (!entry || entry.tenantId !== tenantId) return null; // never cross tenants
  return entry;
}

/** Tenant-scoped list of a server's versions (empty for a cross-tenant probe). */
export function listVersions(reg, tenantId, serverId) {
  return getServer(reg, tenantId, serverId)?.versions ?? [];
}

/**
 * Diff two versions over the agent-visible tool contract.
 * @returns {{ added:string[], removed:string[], changed:Array<{tool:string, fields:string[]}>, requiresReview:boolean }}
 */
export function diffVersions(prev, next) {
  const prevTools = new Map((prev?.tools ?? []).map((t) => [t.name, toolContract(t)]));
  const nextTools = new Map((next?.tools ?? []).map((t) => [t.name, toolContract(t)]));
  const added = [...nextTools.keys()].filter((n) => !prevTools.has(n));
  const removed = [...prevTools.keys()].filter((n) => !nextTools.has(n));
  const changed = [];
  for (const [name, nt] of nextTools) {
    const pt = prevTools.get(name);
    if (!pt) continue;
    const fields = [];
    if (pt.description !== nt.description) fields.push('description');
    if (pt.scope !== nt.scope) fields.push('scope');
    if (fields.length > 0) changed.push({ tool: name, fields });
  }
  const requiresReview = added.length > 0 || removed.length > 0 || changed.length > 0;
  return { added, removed, changed, requiresReview };
}

/**
 * Activate a version. A `requiresReview` version is refused unless `approved` is passed (recording
 * the tenant's approval). Exactly one version is active at a time.
 * @returns {{ ok:boolean, violations:Array }}
 */
export function activateVersion(reg, tenantId, serverId, version, { approved = false } = {}) {
  const entry = getServer(reg, tenantId, serverId);
  if (!entry) return { ok: false, violations: [violation('server_not_found', 'No such server for this tenant.', 'serverId')] };
  const record = entry.versions.find((v) => v.version === version);
  if (!record) return { ok: false, violations: [violation('version_not_found', `Version "${version}" not found.`, 'version')] };

  if (record.requiresReview && !record.approved && !approved) {
    return { ok: false, violations: [violation('review_required', `Version "${version}" changes tool descriptions/scopes and must be approved before it can serve traffic.`, 'version')] };
  }
  if (approved) record.approved = true;

  for (const v of entry.versions) v.active = false;
  record.active = true;
  entry.activeVersion = version;
  return { ok: true, violations: [] };
}

/**
 * Roll back to a previously approved version. No re-review (it was approved before).
 * @returns {{ ok:boolean, violations:Array }}
 */
export function rollbackToVersion(reg, tenantId, serverId, version) {
  const entry = getServer(reg, tenantId, serverId);
  if (!entry) return { ok: false, violations: [violation('server_not_found', 'No such server for this tenant.', 'serverId')] };
  const record = entry.versions.find((v) => v.version === version);
  if (!record) return { ok: false, violations: [violation('version_not_found', `Version "${version}" not found.`, 'version')] };
  if (!record.approved && record.requiresReview) {
    return { ok: false, violations: [violation('not_previously_approved', `Cannot roll back to "${version}": it was never approved.`, 'version')] };
  }
  for (const v of entry.versions) v.active = false;
  record.active = true;
  entry.activeVersion = version;
  return { ok: true, violations: [] };
}

/**
 * Deploy-time supply-chain gate: pinned + allowed registry + verified signature.
 * Mirrors scripts/lib/quality-gates.mjs image rules; the signature verdict is injected (ADR-4).
 * @param {{image:string, signatureVerified?:boolean, allowedRegistries?:string[], requireSignature?:boolean}} input
 * @returns {{ ok:boolean, violations:Array }}
 */
export function verifyImageForDeploy({ image, signatureVerified = false, allowedRegistries = [], requireSignature = true } = {}) {
  const violations = [];
  if (!image) {
    violations.push(violation('missing_image', 'A container image is required.', 'image'));
    return { ok: false, violations };
  }
  const { registry, tag } = parseImageRef(image);
  if (!isPinnedImage(image)) {
    violations.push(violation('image_not_pinned', `Image must be pinned to a digest or a concrete (non-"latest") tag; received "${tag ?? '(none)'}".`, 'image'));
  }
  if (allowedRegistries.length > 0 && !allowedRegistries.includes(registry)) {
    violations.push(violation('registry_not_allowed', `Image registry "${registry ?? '(docker hub)'}" is not on the allow-list.`, 'image'));
  }
  if (requireSignature && !signatureVerified) {
    violations.push(violation('signature_unverified', 'Image signature did not verify (cosign).', 'image'));
  }
  return { ok: violations.length === 0, violations };
}
