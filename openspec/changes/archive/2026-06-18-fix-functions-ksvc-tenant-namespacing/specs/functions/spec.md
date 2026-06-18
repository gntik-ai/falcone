# functions — spec delta for fix-functions-ksvc-tenant-namespacing

## ADDED Requirements

### Requirement: Functions cross-tenant Knative ksvc clobber / code-execution hijack

The system SHALL ensure that functions cross-tenant Knative ksvc clobber / code-execution hijack is corrected: Include tenant id + workspace id (or a hash) in the ksvc name and/or a per-tenant namespace; resolve invoke to the caller-scoped ksvc.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Two same-named workspaces across tenants get distinct ksvcs
