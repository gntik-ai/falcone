## Why

Issue #972 demonstrates that a tenant function can call another tenant's cluster-local Knative
host without passing through control-plane authorization or recording an activation. Runtime POSTs
currently execute arbitrary function source without authentication, and function pods lack a label
that a targeted NetworkPolicy can select.

## What Changes

- Authenticate every runtime POST using a short-lived, asymmetric control-plane credential before
  evaluating function source; preserve unauthenticated health probes.
- Bind credentials to the ksvc, tenant, workspace, verified caller and request body.
- Put only public verification keys in function revisions and preserve stable ksvc names.
- Stamp `in-falcone.io/component: function` on the ksvc pod template.
- Add an ownership-checked, idempotent re-roll procedure through the existing PATCH API.
- In falcone-charts, add a default-enabled, configurable function NetworkPolicy selecting the new
  label, allowing Knative data-plane ingress and only DNS plus explicit egress destinations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `functions`: authenticated execution and targeted function network isolation.

## Scope

This source ChangeSet implements the runtime, signer, manifest, tests and operational contract.
External Secrets/OpenBao key delivery and the NetworkPolicy belong to falcone-charts. No live
mutation, deployment, service mesh, namespace-wide default-deny or worker-profile change is included.
