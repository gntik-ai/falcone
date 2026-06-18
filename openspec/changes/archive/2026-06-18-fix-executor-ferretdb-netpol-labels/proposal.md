# fix-executor-ferretdb-netpol-labels

## Change type
bugfix

## Capability
control-plane-runtime

## Priority
P1

## Why
`deploy/kind/executor-demo.yaml` labels the executor `app=falcone-cp-executor`, but the FerretDB NetworkPolicy ingress allows `app.kubernetes.io/name=control-plane-executor` → executor mongo CRUD 500 (TCP dropped by kindnet).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: executor mongo insert → 500 (timeout); after adding `app.kubernetes.io/name: control-plane-executor` to the pod → 201. Control-plane (correct label) connects in ~2ms.

GitHub issue #559 (epic #542). Evidence: `audit/live-campaign/evidence/21-document-mongo.md`.

## What Changes
Set `app.kubernetes.io/name: control-plane-executor` on the executor pod template; align the chart `controlPlaneExecutor` labels with the NetworkPolicy contract.

## Impact
Executor mongo CRUD 2xx on a clean deploy.
