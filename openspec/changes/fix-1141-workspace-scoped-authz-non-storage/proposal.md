# Workspace authorization beyond storage (#1141)

## Why

Tenant-only workspace resolution allows an unbound tenant member, or a development
workspace member, to reach production resources in the same tenant. Storage's
#973 predicate was private, leaving functions, data, events, webhooks, realtime
configuration and storage usage without the same boundary.

## What changes

Use one shared workspace visibility gate, derived from verified identity roles,
tenantId and workspaceIds and persisted workspace/resource rows. Keep resource
action checks and owner/admin structural checks in addition to that gate. Deny
before Knative, Kafka, data connections, webhook actions or S3 operations.

Apply the gate to function workspace and resource resolution, PostgreSQL and
MongoDB data and metadata, Kafka workspace/topic resolution (including SSE),
workspace-addressed webhooks (including the static event catalogue), realtime
configuration and storage usage. MongoDB metadata uses registered workspace
mappings and counts only documents stamped with authorized tenant/workspace pairs.

Refactor the existing storage bucket predicate through the shared gate without
changing its responses, payloads or tests. Its legacy owner/admin model grants for
unmapped buckets remain an explicit compatibility exception; new gates fail closed
on missing mappings. Preserve existing Function platform-trust read checks and
write-capable role checks. Function workspace denials use WORKSPACE_NOT_FOUND 404,
including previously uniform 403 workspace resolution denials, without an existence
oracle. Action/activation denials retain their existing 404 envelopes.

## Compatibility and scope

Unbound service accounts and users lose access, including invocation paths. Bound
workspace_service_account identities with model grants remain supported. A path,
body workspaceId, singular ambient workspaceId or x-* header supplies no authority.
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
