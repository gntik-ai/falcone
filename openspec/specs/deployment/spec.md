# deployment Specification

## Purpose
TBD - created by archiving change fix-install-health-gate-probes. Update Purpose after archive.
## Requirements
### Requirement: Install health gate probes paths/clients that reflect real health

The install health gate SHALL probe endpoints and use clients that reflect the platform's
actual health, so it passes when the platform is healthy:

- The gateway health probe SHALL hit a gateway route that returns 200 when the gateway is up
  and routing to the control plane (the gateway `/health` route is rewritten to the
  control-plane health endpoint it actually serves, `/healthz`).
- A datastore reachability probe behind a NetworkPolicy that admits only specific app
  components SHALL run from a client the policy admits (the smoke pod is labelled as an
  admitted component), so a reachable datastore is not reported unreachable.

#### Scenario: the gateway health probe passes when the gateway is up

- **WHEN** the gate probes the gateway `/health` route and the platform is healthy
- **THEN** it receives 200 (the route resolves to the control-plane `/healthz`), not a 404

#### Scenario: a NetworkPolicy-protected datastore probe reflects real reachability

- **WHEN** the gate probes a datastore whose NetworkPolicy admits only named app components
- **THEN** the probe runs from a client admitted by the policy and reports the datastore reachable

