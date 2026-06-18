# storage — spec delta for fix-seaweedfs-netpol-bucket-hook

## ADDED Requirements

### Requirement: SeaweedFS netpol blocks the bucket-provisioning hook (fresh install hangs)

The system SHALL ensure that seaweedFS netpol blocks the bucket-provisioning hook (fresh install hangs): Allow the bucket-hook in the netpol (label it `app.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A from-scratch install on a NetworkPolicy-enforcing cluster completes without disabling the netpol
