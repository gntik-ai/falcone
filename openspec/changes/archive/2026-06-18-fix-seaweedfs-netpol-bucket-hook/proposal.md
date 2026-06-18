# fix-seaweedfs-netpol-bucket-hook

## Change type
bugfix

## Capability
storage

## Priority
P1

## Why
The `seaweedfs-internal-only` NetworkPolicy restricts master/filer ports to `app.kubernetes.io/name: seaweedfs`, but the upstream bucket-hook pod has no such label -> on any NetworkPolicy-enforcing CNI the hook's `wget /cluster/status` is dropped, hanging the post-install hook chain and the whole `helm install`. The chart comment wrongly assumes kind does not enforce NetworkPolicy.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: bucket-hook stuck 'Service not ready'; `curl master:9333` from an unlabeled pod -> 000; `wget localhost:9333/cluster/status` inside the master -> `{IsLeader:true}`. install hung until `seaweedfs.networkPolicy.enabled=false`.

GitHub epic F. Evidence: `audit/live-campaign/evidence-rerun/00-stack-and-install.md`.

## What Changes
Allow the bucket-hook in the netpol (label it `app.kubernetes.io/name: seaweedfs` or add an ingress rule); update the chart comment.

## Impact
A from-scratch install on a NetworkPolicy-enforcing cluster completes without disabling the netpol.
