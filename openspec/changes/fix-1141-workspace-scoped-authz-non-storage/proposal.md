# Workspace authorization beyond storage (#1141)

## Why

Tenant-only workspace resolution allows an unbound tenant member, or a development
workspace member, to reach production resources in the same tenant. The storage
predicate from #973 was private, leaving functions, data, events, webhooks, realtime
configuration and storage usage without the same boundary.

## What changes

Use one shared workspace visibility gate, derived from verified identity roles,
tenantId and workspaceIds and persisted workspace/resource rows. Keep resource
action checks and owner/admin structural checks in addition to that gate. Deny
before Knative, Kafka, data connections, webhook actions or S3 operations.

Apply the gate to function workspace and resource resolution, PostgreSQL and
MongoDB data and metadata, Kafka workspace/topic resolution (including SSE),
workspace-addressed webhooks (including the static event catalogue), realtime
configuration and storage usage. MongoDB metadata requires registered workspace
mappings before connecting. Bound members count only documents stamped with an
authorized tenant/workspace pair. Verified tenant owners/admins keep tenant-wide
counts, including legacy documents stamped only with tenantId, within mapped databases.
Unregistered databases remain hidden for non-platform callers: a database name or
legacy document alone cannot establish the missing workspace mapping.

Refactor the existing storage bucket predicate through the shared gate without
changing its responses, payloads or tests. Its legacy owner/admin model grants for
unmapped buckets remain an explicit compatibility exception; new gates fail closed
on missing mappings. Preserve existing Function platform-trust read checks and
write-capable role checks. Function inventory, action-list and create/update workspace
resolution retain the existing uniform 403 FORBIDDEN envelope for absent, foreign
and unauthorized workspaces. These operations had no existing 404 workspace shape;
this compatibility exception preserves the published OpenAPI and cross-tenant
responses. Function secrets and action/activation denials keep their existing 404s.

## Compatibility and scope

Unbound service accounts and users lose access, including invocation paths. No new
service-account role receives Function read or invoke authority; the existing
Function role checks remain additional requirements even after a model grant.
A path, body workspaceId or x-* header supplies no authority. The former singular
identity.workspaceId fallback for Function reads/invocations is also removed:
verified identity.workspaceIds must contain the workspace. This is an intentional
fail-closed compatibility break, separate from any future IAM claim issuance.
Internal calls retain their existing actor/trust requirements; this change does not
reclassify an unbound Knative caller as internal. IAM claim issuance and rollout
sequencing remain operator work.

Tenant-addressed webhook behavior, authorization-model.json, route tiers, server
authorization deferral, tenant APIs, deployment files and chart pins do not change.
The route coverage test freezes the existing IAM/lifecycle/registry/metrics and
tenant-addressed webhook exclusions, and exercises every remaining addressed route
through its exported handler. New addressed routes require explicit coverage or
scope review. Existing storage workspace list/provision 403 responses remain pinned.

## Risk and validation

R3: independent maker/checker review by both providers and human approval are
delivery gates owned by the control plane. Rollback is a source revert and release
of the previous immutable image; no schema migration is needed.

The initial reproduction was `node tests/unit/workspace-resource-authz.test.mjs`:
an unbound viewer received realtime metadata with 200 and a downstream query instead
of WORKSPACE_NOT_FOUND 404. Vertical regression slices also reproduced function
listing/export, actorType-only PostgreSQL access, MongoDB access, Kafka topic reads,
workspace webhook catalogue access and storage usage before fixing each path.
The confirmed cause was tenant-only resolution, with actorType-only structural
checks insufficient to establish verified workspace authority.

Run the new workspace authorization suites and the existing per-family tests.
Replay against the immutable deployed image and evaluate production automation
compatibility after approval; the source maker does not deploy or replay live traffic.

## Checker corrections

The follow-up reproduced the stale secret fixtures with
`node tests/unit/workspace-secret-role-gate.test.mjs`: actorType-only owners got 404,
unbound writes got 404 instead of the old 403, and unbound reads no longer got 200.
Fixtures now carry verified roles. Bound viewers/developers still exercise the
additional 403 mutation gate; unbound/wrong-workspace members exercise 404 for all
secret operations with no vault access. The delete and audit fixtures and the
blackbox secret fixtures use verified administrator roles.

Before source corrections, `node tests/unit/workspace-resource-authz.test.mjs`
failed on the changed Function denial envelope and newly granted service-account
read. It now pins the original uniform Function workspace 403 and denies that new
grant. `node tests/unit/workspace-data-authz.test.mjs` reproduced administrator
metadata undercounting (2 instead of 3); tenant-wide legacy counts are restored,
while unbound callers and missing mappings still deny before connection.

Family action sets are named in the shared module; realtime uses existing database
capabilities and webhooks existing topic capabilities, with no model change. MongoDB
documents reuse the export/import workspace resolver. The redundant storage
provision visibility check is removed; its existing bucket.admin gate is unchanged.

The prior family implementation is already committed. The assigned follow-up
requires one additional local commit and forbids history rewriting, so family
history is not split retrospectively. Review the family files as separate axes.
