# Owned Function secret projections

OpenBao remains the system of record. A namespace-scoped Kubernetes Secret is a derived projection
of only a Function's declared, tenant/workspace-scoped references. This keeps the
external-secrets-openbao-not-bypassed invariant: the product still reads/writes source material only
through its OpenBao workspace store. An ExternalSecret would require a separate tenant SecretStore
policy model; this change reuses the existing control-plane OpenBao authorization boundary.

Use one Secret per Function, tenant/Function ownership labels, resourceVersion-guarded adoption,
and an owner reference to the Service UID. Secret env references use `optional: false`. Replacement
uses a full data-map write to remove dropped keys; redeploy without secrets deletes the projection.
Create the projection before creating or patching the Service. Roll back newly created resources
on failure; restore the previous data map after a rejected Service update using ownership and
resourceVersion guards. Retain a durable Function cleanup obligation if rollback cannot complete. Errors
from Kubernetes are replaced with value-free messages before reaching deploy responses.

Action and version `secret_refs` columns are additive, idempotent JSONB migrations with empty-array
defaults. Only names and env mappings are persisted. A rollback resolves the current OpenBao values
for its retained declaration. Consumer counts count Functions, rather than aliases or versions.
DELETE preserves 204 with affected Function IDs in headers; replace returns the same IDs in metadata.

Rotation/revocation also inspect all five workload kinds and delete legacy inline Revisions using
UID/resourceVersion preconditions and foreground GC. Descendants must trace to the owned Service
UID. Success requires a fresh scan with no inline literals; asynchronous reconciliation remains
retryable and cannot be reported as successful revocation. Existing action rows with lost custom
mappings require explicit operator-provided names/mappings for remediation. The shipped command
is read-only by default, reports identifiers/env names only, and requires `--apply` for conversion.
No upgrade hook runs remediation automatically.

Function and aggregate teardown share the owner-safe delete boundary, which explicitly removes the
projection even if the Service disappeared. A Secret deletion error or unobserved deletion leaves
the logical Function and a durable retry obligation. Foreground Service GC removes owned children.
Already-running pods can retain old values in memory; the affected Function list identifies the
rollouts/scale-to-zero an operator should verify. Hosted MCP still receives no workspace secrets.

The deployment repository must keep permissions namespace-scoped. Core Secrets need only create,
get, update, patch and delete (no list/watch). Remediation additionally needs list on Knative
Configurations/Revisions and apps Deployments/ReplicaSets, and delete on Knative Revisions; it uses
no writes to Configurations/Deployments/ReplicaSets. The existing Service permissions remain.
Rolling back those permissions causes fail-closed errors; rolling back the source image can
reintroduce inline injection and requires coordinated review. Live marker checks, RBAC rendering,
and deployment are delivery-gate responsibilities and are not performed by this source maker.

Deploy, rollback, Function deletion, secret replacement/revocation, and remediation serialize per
workspace. PostgreSQL advisory locks coordinate control-plane replicas across resolution, runtime
writes and registry persistence, so an in-flight deploy cannot republish a value after revocation.
