# web-console — spec delta for fix-790-flows-capability-gate

## ADDED Requirements

### Requirement: Console capability gates reference real catalog capability keys

The system SHALL gate a console feature only on a capability key that exists in the platform
boolean-capability catalog (the keys seeded by the provisioning-orchestrator migrations
`104-plan-boolean-capabilities.sql` and `114-backup-scope-deployment-profiles.sql`:
`sql_admin_api, passthrough_admin, realtime, webhooks, public_functions, custom_domains,
scheduled_functions, backup_scope_access`), so the gate is satisfiable for a tenant whose plan grants
that capability. Because `useCapabilityGate` is fail-closed and the effective-capabilities endpoint
only ever returns keys present in the catalog, gating on a key absent from the catalog (e.g.
`workflows`, `functions_public`) is a defect: the gate can never be satisfied and the surface renders
permanently disabled for every tenant on every plan. The console SHALL constrain the
`CapabilityGate` `capability` prop and the `useCapabilityGate` key to the catalog key set at compile
time, and SHALL NOT gate the Flows pages (the flow control-plane API is not plan-gated).

#### Scenario: Tenant opening the Flows console gets an interactive UI

- **WHEN** a tenant opens `/console/flows` (with a workspace selected) and the effective-capabilities
  map does not contain a `workflows` key — the universal state, since `workflows` is absent from the
  boolean-capability catalog
- **THEN** the Flows UI is interactive (not wrapped in `[data-testid="capability-gate-disabled"]`,
  no `pointer-events-none` overlay, no upgrade badge), and the "New flow" / "Open designer" controls
  are rendered and usable.

#### Scenario: Every console capability gate references a catalog key

- **WHEN** any console page uses `CapabilityGate capability="X"` or `useCapabilityGate('X')`
- **THEN** `X` is a member of the platform boolean-capability catalog key set, verified by an
  automated audit that scans the web-console source.
