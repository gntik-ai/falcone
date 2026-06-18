# Tasks — fix-seaweedfs-netpol-bucket-hook

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: bucket-hook stuck 'Service not ready'; `curl master:9333` from an unlabeled pod -> 000; `wget localhost:9333/cluster/status` inside the master -> `{IsLeader:true}`.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Allow the bucket-hook in the netpol (label it `app.kubernetes.io/name: seaweedfs` or add an ingress rule); update the chart comment.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A from-scratch install on a NetworkPolicy-enforcing cluster completes without disabling the netpol.

## Archive
- [ ] `openspec validate fix-seaweedfs-netpol-bucket-hook --strict`; `/opsx:archive fix-seaweedfs-netpol-bucket-hook` after merge.
