# Tasks — fix-seaweedfs-netpol-bucket-hook

## Reproduce (test-first)
- [x] `tests/blackbox/seaweedfs-netpol-bucket-hook.test.mjs` — fails on old code: the netpol admits only `app.kubernetes.io/name: seaweedfs` on master/filer, never the `{release}-bucket-hook` Job.

## Implement (kind runtime AND shippable product as applicable)
- [x] `charts/in-falcone/templates/seaweedfs-networkpolicy.yaml`: admit the bucket-hook to the intra-SeaweedFS (master/filer) ports by its Job-name label (`job-name` + `batch.kubernetes.io/job-name` = `{release}-bucket-hook`).
- [x] `tests/live-campaign/values-campaign.yaml`: re-enable `seaweedfs.networkPolicy.enabled: true` (the campaign workaround had disabled it) so the next run validates the fix.

## Verify
- [x] `node --test tests/blackbox/seaweedfs-netpol-bucket-hook.test.mjs` green (static + rendered helm template).
- [x] Acceptance: a from-scratch install on a NetworkPolicy-enforcing cluster completes with the netpol enabled (bucket-hook reaches master/filer).

## Archive
- [ ] `openspec validate fix-seaweedfs-netpol-bucket-hook --strict`; `/opsx:archive fix-seaweedfs-netpol-bucket-hook` after merge.
