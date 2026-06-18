# storage — spec delta for fix-seaweedfs-netpol-bucket-hook

## ADDED Requirements

### Requirement: The SeaweedFS netpol admits the bucket-provisioning hook

The SeaweedFS internal-only NetworkPolicy SHALL admit the upstream subchart's
post-install bucket-provisioning hook (`{release}-bucket-hook`) to the master/filer
ports, selected narrowly by its Job-name label, so a from-scratch install completes on
a NetworkPolicy-enforcing CNI without disabling the policy.

#### Scenario: a from-scratch install completes with the netpol enabled

- **WHEN** the chart is installed on a NetworkPolicy-enforcing cluster with
  `seaweedfs.networkPolicy.enabled=true`
- **THEN** the bucket-hook can reach the master/filer (its traffic is not dropped), the
  post-install hook chain completes, and `helm install` does not hang — without disabling
  the storage-tier network isolation.
