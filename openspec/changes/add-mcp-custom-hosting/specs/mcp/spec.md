## ADDED Requirements

### Requirement: A tenant can host a custom MCP server from a container image
The system SHALL deploy a tenant-provided MCP server container image as a workload in the tenant's namespace that is internal-only and scales to zero when idle, carrying the platform's MCP-server label so the per-tenant NetworkPolicy applies.

#### Scenario: Custom image is deployed as an internal-only, scale-to-zero MCP server
- **WHEN** a tenant provides a valid, allowed container image to host as an MCP server
- **THEN** the platform produces a deployment for that image in the tenant's namespace, labeled as an MCP server (so it is reachable only via the gateway) and configured to scale to zero when idle

### Requirement: Custom server images are supply-chain validated
The system SHALL reject a custom-server image that is not from an allowed registry or that is not pinned (an image referenced by a mutable `latest` tag, or otherwise unpinned, MUST be rejected).

#### Scenario: Disallowed registry is rejected
- **WHEN** a custom-server image references a registry that is not on the allow-list
- **THEN** the deployment is refused with a validation error

#### Scenario: Unpinned (`latest`) image is rejected
- **WHEN** a custom-server image is referenced by the mutable `latest` tag (or no tag/digest)
- **THEN** the deployment is refused with a validation error

### Requirement: Custom servers run non-root under a restricted security context
The system SHALL deploy custom MCP servers to run as non-root with no privilege escalation and dropped capabilities, compatible with OpenShift restricted SCC.

#### Scenario: Custom server runs non-root
- **WHEN** a custom server is deployed
- **THEN** its workload is configured to run as non-root with privilege escalation disabled and capabilities dropped
