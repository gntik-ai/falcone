# fix-campaign-image-pull-policy

## Change type
bugfix

## Capability
control-plane-runtime

## Priority
P2

## Why
Rebuilding with the same image tag + `imagePullPolicy: IfNotPresent` runs the old cached image on kind nodes; fixes silently don't take effect. Also `make-secrets.sh` pre-created `in-falcone-gateway-shared-secret` which the chart now self-manages → helm ownership conflict.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: rebuilt executor (with the #517 fix) but the node kept the 9h-old image → F1 looked unfixed until `imagePullPolicy: Always` forced a re-pull.

GitHub issue #561 (epic #542). Evidence: `audit/live-campaign/evidence/../REPORT.md`.

## What Changes
Use unique per-build tags (or `imagePullPolicy: Always`) in install.sh/executor-demo.yaml/values; drop the gateway-secret pre-create (chart owns it).

## Impact
A rebuild always runs the new code on the next deploy.
