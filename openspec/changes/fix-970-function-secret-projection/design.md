# Owned Function secret projections

OpenBao remains the system of record. A namespace-scoped Kubernetes Secret is a derived projection
of only a Function's declared, tenant/workspace-scoped references. This keeps the
external-secrets-openbao-not-bypassed invariant: the product still reads/writes source material only
through its OpenBao workspace store. An ExternalSecret would require a separate tenant SecretStore
policy model; this change reuses the existing control-plane OpenBao authorization boundary.

Use one Secret per Function, tenant/Function ownership labels, resourceVersion-guarded adoption,
and an owner reference to the Service UID. Secret env references use `optional: false`. Replacement
uses a full data-map write to remove dropped keys; redeploy without secrets deletes the projection.
The owner reference omits `blockOwnerDeletion`: explicit owner-checked Secret cleanup and ordinary
garbage collection suffice, without granting `services/finalizers` updates to satisfy owner-reference
admission on OpenShift. Redeploy also removes that flag from an older projection's owner reference.
Create the projection before creating or patching the Service. Roll back newly created resources
on failure; restore the previous data map after a rejected Service update using ownership and
resourceVersion guards. If cleanup of a newly created Function cannot complete, retain its registry
record and a durable Function deletion obligation. A failed redeploy of an existing Function must
not persist the rejected source/refs, snapshot a published version, or mark it for deletion, even
if Secret restoration fails. Return a redacted retryable deploy error and keep its identity and
lifecycle unchanged so the caller can retry deployment to reconcile the projection.
Errors from Kubernetes are replaced with value-free messages before reaching deploy responses.

Action and version `secret_refs` columns are additive, idempotent JSONB migrations with empty-array
defaults. Only names and env mappings are persisted. A rollback resolves the current OpenBao values
for its retained declaration. Consumer counts count Functions, rather than aliases or versions.
Definition imports preserve the existing service name and declared refs when deployment metadata
is absent or null, so importing code cannot detach a live projection from revocation or cleanup.
An explicit empty refs array from deployment still removes the declaration.
DELETE preserves 204 with affected Function IDs in headers; replace returns the same IDs in metadata.
Revocation retains the deleted declaration for consumer counts/warnings and leaves its reference
`optional: false`, even when the projection no longer exists. This intentional fail-closed state
differs from an ordinary deploy/rollback, which rejects a missing source secret before any write.

Rotation/revocation also inspect all five workload kinds and delete legacy inline Revisions using
UID/resourceVersion preconditions and foreground GC. Descendants must trace to the owned Service
UID. Success requires a fresh scan with no inline literals; asynchronous reconciliation remains
retryable and cannot be reported as successful revocation. Existing action rows with lost custom
mappings require explicit operator-provided names/mappings for remediation. The shipped command
is read-only by default, reports identifiers/env names only, and requires `--apply` for conversion.
Namespace discovery (`--discover`) paginates labelled Services and reports all affected owned
descendants without database/OpenBao access or an operator-supplied list of Function IDs. Apply
remains explicitly scoped to the registry tenant/workspace/Function and may require recovered
declarations. Discovery excludes unlabelled workloads and cannot associate descendants whose
owned Service is already gone. No upgrade hook runs remediation automatically.
The scan excludes the reconciler's `queue-proxy` container from Deployment/ReplicaSet checks and
ignores their injected `PORT`, `K_REVISION` and `K_CONFIGURATION` literals unless an owned
Service/Configuration/Revision has that name inline. This retains detection of legacy user mappings
while allowing by-reference workloads with Knative-injected env to pass rotation and remediation.

Function and aggregate teardown share the owner-safe delete boundary, which explicitly removes the
projection even if the Service disappeared. A Secret deletion error or unobserved deletion leaves
the logical Function and a durable retry obligation. Foreground Service GC removes owned children.
Leaf Secrets use background deletion and a fresh absence check, avoiding a foreground finalizer
that would otherwise make revocation or an empty redeploy fail before GC runs. Services and legacy
Revisions retain foreground deletion: pending GC is reported and retryable through the existing APIs.
Pending legacy GC returns 502 with `pendingResources` from secret replace/delete until retried
successfully (200/204). Function DELETE normally returns 202 while foreground Service GC is pending.
There is no automatic reconciler: callers retry Function DELETE or tenant/workspace purge to
complete durable cleanup obligations.
Already-running pods can retain old values in memory; the affected Function list identifies the
rollouts/scale-to-zero an operator should verify. Hosted MCP still receives no workspace secrets.

The deployment repository must keep permissions namespace-scoped. Core Secrets need only create,
get, update, patch and delete (no list/watch). Remediation additionally needs list on Knative
Configurations/Revisions and apps Deployments/ReplicaSets, and delete on Knative Revisions; it uses
no writes to Configurations/Deployments/ReplicaSets. The existing Service permissions remain.
Rolling back those permissions causes fail-closed errors; rolling back the source image can
reintroduce inline injection and requires coordinated review. Live marker checks, RBAC rendering,
and deployment are delivery-gate responsibilities and are not performed by this source maker.

Deploy, definition import, rollback, Function deletion, secret replacement/revocation, and remediation
serialize per workspace. PostgreSQL advisory locks coordinate control-plane replicas across resolution, runtime
writes and registry persistence, so an in-flight deploy cannot republish a value after revocation.
