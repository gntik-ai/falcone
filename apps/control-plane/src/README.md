# Control Plane

Reserved for the control plane application.

Initial responsibility boundaries:

- public control-plane APIs and versioning
- tenant and workspace metadata
- platform configuration workflows
- translation into internal control/provisioning contracts
- internal health and readiness endpoints

Scaffolding added by `US-ARC-01-T01`:

- `internal-service-map.mjs` exposes the control API slice of the shared contract package
- provider-specific implementation remains out of this workspace
