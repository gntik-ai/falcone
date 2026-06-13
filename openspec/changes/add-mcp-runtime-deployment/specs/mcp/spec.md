## ADDED Requirements

### Requirement: Per-tenant MCP runtime footprint is provisioned and torn down
The system SHALL provision a tenant's MCP runtime footprint (namespace labels, RBAC allowing the control-plane to manage MCP-server ksvcs in that namespace, and NetworkPolicies) when MCP hosting is enabled for the tenant, and SHALL tear it down idempotently when the tenant is deprovisioned or MCP hosting is disabled.

#### Scenario: Footprint created on enable
- **WHEN** MCP hosting is enabled for a tenant
- **THEN** the tenant's namespace has the RBAC and NetworkPolicies required to run MCP-server ksvcs

#### Scenario: Teardown is idempotent
- **WHEN** the MCP footprint is torn down and the teardown is retried
- **THEN** the operation succeeds without error and leaves no MCP runtime resources in the namespace

### Requirement: MCP-server workloads are internal-only
The system SHALL restrict MCP-server pods so that inbound traffic is accepted only from the platform gateway and SHALL constrain their egress; MCP-server pods MUST NOT be directly reachable from outside the platform gateway path.

#### Scenario: Direct ingress bypassing the gateway is denied
- **WHEN** a workload attempts to reach an MCP-server pod directly, not via the platform gateway, on a cluster with NetworkPolicy enforcement
- **THEN** the connection is denied

### Requirement: MCP runtime resources are OpenShift-safe
The system SHALL deploy MCP runtime resources to run as non-root under a restricted security context (no privileged escalation, numeric non-root UID), compatible with OpenShift restricted SCC.

#### Scenario: Pods run non-root
- **WHEN** an MCP-server workload is scheduled under a restricted SCC profile
- **THEN** it runs as a non-root user without requesting privileged capabilities
