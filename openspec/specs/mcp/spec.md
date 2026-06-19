# mcp Specification

## Purpose
TBD - created by archiving change add-mcp-hosting-adr-spikes. Update Purpose after archive.
## Requirements
### Requirement: MCP hosting runtime is per-tenant and internal-only
The system SHALL host each tenant's MCP server inside that tenant's own Kubernetes namespace, and the runtime control plane (operator/controller) and the servers themselves SHALL NOT be reachable from another tenant's namespace or from tenant-facing traffic paths except through the platform's MCP gateway.

#### Scenario: Cross-namespace probe is denied
- **WHEN** a workload in tenant B's namespace attempts to reach an MCP server running in tenant A's namespace directly
- **THEN** the connection is refused by NetworkPolicy and no MCP response is returned

#### Scenario: Runtime control plane is not tenant-exposed
- **WHEN** a tenant attempts to reach the MCP runtime operator/controller endpoints over a tenant-facing path
- **THEN** the request does not resolve to the runtime control plane

### Requirement: Remote MCP transport is Streamable HTTP through the platform gateway
The system SHALL expose remote MCP servers only over Streamable HTTP via the platform's internal gateway, and SHALL NOT expose stdio transport for remote access (stdio is local-development only).

#### Scenario: Remote client connects over Streamable HTTP
- **WHEN** an MCP client connects to a hosted server's published endpoint
- **THEN** the connection is served over Streamable HTTP through the gateway

#### Scenario: stdio is not a remote transport
- **WHEN** a remote client attempts to use stdio transport against a hosted server
- **THEN** no remote stdio endpoint is available

### Requirement: Remote MCP access requires OAuth 2.1 scoped tokens
The system SHALL require a valid OAuth 2.1 access token, issued by the tenant's Authorization Server, to call a hosted MCP server, and SHALL enforce per-tool scopes. A presented-but-invalid or insufficiently-scoped token MUST be rejected and MUST NOT fall back to client-supplied identity.

#### Scenario: Missing or invalid token is rejected
- **WHEN** a client calls a hosted MCP server without a valid token
- **THEN** the gateway returns 401 and the call does not reach the server

#### Scenario: Tool call without the tool's scope is rejected
- **WHEN** a client presents a token lacking the scope required by a specific tool
- **THEN** the call to that tool returns 403

### Requirement: Instant-MCP generation requires mandatory curation before publish
The system SHALL route every auto-generated tool set through a mandatory curation step (enable/disable, description rewrite, scope assignment) before it can be published, and SHALL NOT serve an un-curated, auto-generated server to clients.

#### Scenario: Un-curated generated server cannot be connected
- **WHEN** Instant MCP is toggled on and a draft tool manifest is generated but not yet published through curation
- **THEN** no connectable endpoint serves those tools

#### Scenario: Curated server is publishable
- **WHEN** a tenant prunes tools, rewrites descriptions, assigns scopes, and publishes
- **THEN** only the curated, published tool set is served

### Requirement: MCP hosting is stateless with scale-to-zero for idle servers
The system SHALL implement MCP request handling against the stateless protocol core, and idle tenant MCP servers SHALL scale to zero and cold-start on demand without losing the ability to serve subsequent requests.

#### Scenario: Idle server scales to zero
- **WHEN** a hosted MCP server receives no traffic for the configured idle period
- **THEN** it scales to zero and consumes no running compute

#### Scenario: Scaled-to-zero server cold-starts on demand
- **WHEN** a client calls a server that has scaled to zero
- **THEN** the server cold-starts and serves the request

### Requirement: MCP servers, tools, logs and credentials are tenant-isolated
The system SHALL scope every MCP server, its tools, its execution logs/audit, and its OAuth clients/credentials to the owning tenant, such that one tenant can never enumerate or access another tenant's MCP servers, tools, logs or credentials.

#### Scenario: Tenant cannot enumerate another tenant's servers
- **WHEN** tenant A lists or queries MCP servers, tools, logs, or OAuth clients
- **THEN** only tenant A's resources are returned and tenant B's are never disclosed

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

### Requirement: MCP servers are reached only through the gateway over Streamable HTTP
The system SHALL expose hosted MCP servers to remote clients exclusively through the platform gateway over Streamable HTTP, and the gateway SHALL proxy a request only to the MCP server owned by the tenant resolved from the verified credential.

#### Scenario: Streamable-HTTP request is proxied to the tenant's server
- **WHEN** a client calls a hosted MCP server's endpoint with a valid token over Streamable HTTP
- **THEN** the gateway proxies it to that tenant's MCP-server workload and streams the response

#### Scenario: Cross-tenant routing is denied
- **WHEN** a client presents a token for tenant A and targets tenant B's MCP server
- **THEN** the gateway does not route the request to tenant B's server

### Requirement: The gateway enforces OAuth 2.1 and per-tool scopes for MCP
The gateway SHALL reject any MCP request without a valid OAuth 2.1 access token (`401`) and SHALL reject a tool call whose token lacks the tool's required scope (`403`), without falling back to client-supplied identity.

#### Scenario: Missing or invalid token
- **WHEN** an MCP request arrives without a valid OAuth 2.1 token
- **THEN** the gateway returns `401` and does not reach the server

#### Scenario: Insufficient per-tool scope
- **WHEN** a token lacks the scope required by the targeted tool
- **THEN** the gateway returns `403`

### Requirement: MCP gateway traffic is observable
The gateway SHALL emit a telemetry span for each MCP request carrying at least the tenant, server, and OAuth-client identifiers, fed into the platform's existing observability pipeline.

#### Scenario: Per-request span emitted
- **WHEN** an MCP request passes through the gateway
- **THEN** a span/log attributed to the tenant, server and OAuth client is recorded

### Requirement: The tenant's Authorization Server issues per-tool-scoped tokens
The system SHALL represent each curated MCP tool as a scope in the tenant's OAuth 2.1 Authorization Server, and a token issued to an authorized MCP client SHALL carry the scopes for the tools that client is permitted to call.

#### Scenario: Issued token carries the per-tool scope
- **WHEN** an authorized MCP client obtains a token for a tool it is permitted to call
- **THEN** the token's scope claim includes that tool's scope

#### Scenario: Tool scope absent when not granted
- **WHEN** a client is not granted a tool's scope
- **THEN** tokens issued to that client do not carry that tool's scope

### Requirement: MCP client registration is curated through Falcone
The system SHALL register MCP OAuth clients through the platform's own API (tenant-scoped, plan-limited), validate that redirect URIs are HTTPS, and SHALL NOT expose the raw Keycloak admin or dynamic-client-registration endpoints to tenants.

#### Scenario: Non-HTTPS redirect URI is rejected
- **WHEN** an MCP client is registered with a non-HTTPS redirect URI
- **THEN** registration is rejected with a validation error

#### Scenario: Registration is tenant-scoped and curated
- **WHEN** a tenant registers an MCP client
- **THEN** the client is created in that tenant's realm via the platform, without the tenant accessing Keycloak admin directly

### Requirement: MCP authorization supports consent and token revocation
The system SHALL present and record end-user consent when an MCP client is authorized, and SHALL allow a tenant to revoke an MCP client's tokens such that revoked tokens are no longer accepted.

#### Scenario: Consent is recorded
- **WHEN** an end-user authorizes an MCP client for a set of tool scopes
- **THEN** the consent is presented and recorded for that (user, client, scopes)

#### Scenario: Revoked token is rejected
- **WHEN** a tenant revokes an MCP client and the client presents a previously issued token
- **THEN** the token is rejected

### Requirement: Falcone ships a first-party, read-first MCP server
The system SHALL provide a first-party MCP server that exposes a curated catalog of Falcone management tools, where read (non-mutating) tools are callable with the base MCP scope and every mutating tool requires an explicit, named per-tool scope.

#### Scenario: Read tool callable by default
- **WHEN** a client lists tools and calls a read (non-mutating) tool with the base MCP scope
- **THEN** the server returns the result without requiring an additional scope

#### Scenario: Mutating tool refused without its scope
- **WHEN** a client calls a mutating tool whose explicit scope is not in the caller's granted scopes
- **THEN** the server refuses the call

#### Scenario: Mutating tool allowed with its scope
- **WHEN** a client calls a mutating tool and the caller holds that tool's explicit scope
- **THEN** the server performs the operation against the control-plane on behalf of the credential-derived tenant

### Requirement: First-party tools are curated and LLM-optimized
Every tool in the first-party catalog SHALL carry a non-trivial, LLM-optimized description and an input schema, and mutating tools SHALL be clearly identifiable as such; the catalog SHALL be a curated subset of the management surface, not a 1:1 export of every route.

#### Scenario: Every tool is described and classified
- **WHEN** the catalog is inspected
- **THEN** every tool has a description and an input schema, and each tool is marked as read or mutating with mutating tools carrying a scope

### Requirement: Instant MCP generates a draft tool manifest from tenant resources
The system SHALL generate MCP tools from a tenant's existing resources — database schema, functions, storage and events — via an extensible set of per-resource generators, producing a draft manifest in which each tool has a name, an LLM-oriented description, an input schema, a mutation flag, a suggested scope, and a reference to its source resource.

#### Scenario: Schema produces query tools
- **WHEN** Instant MCP generation runs over a database schema with tables
- **THEN** the draft manifest contains a read query tool per table whose input schema is derived from the table's columns

#### Scenario: Functions, storage and events produce tools
- **WHEN** generation runs over the tenant's functions, storage buckets and event topics
- **THEN** the draft manifest contains corresponding action, object and publish/subscribe tools

### Requirement: Generated tools are never published without curation
The Instant MCP generator SHALL only ever produce a draft manifest marked as requiring curation, and SHALL NOT produce a published/connectable tool set; publishing happens only after curation.

#### Scenario: Output is a draft requiring curation
- **WHEN** the generator runs
- **THEN** the resulting manifest is marked as a draft that requires curation, and no tool is connectable until it is curated and published

### Requirement: Generated data tools map to tenant-scoped, RLS-bound operations
Generated tools that read or write tenant data SHALL map to the platform's tenant-scoped, RLS-bound data operations, so that executing a generated tool cannot return or modify another tenant's data.

#### Scenario: Generated query tool is tenant-scoped
- **WHEN** a generated query tool maps to a database table operation
- **THEN** it targets the platform's RLS-bound data path so the operation is constrained to the calling tenant

### Requirement: A draft tool set is curated before it can be served
The system SHALL let a tenant curate a draft tool set — enable or disable individual tools, override their descriptions, and assign per-tool scopes — producing a curated tool set distinct from the draft.

#### Scenario: Disabled tools are excluded
- **WHEN** a curator disables a tool and applies the curation
- **THEN** the curated tool set does not contain that tool

#### Scenario: Description and scope edits are applied
- **WHEN** a curator overrides a tool's description and assigns it a scope
- **THEN** the curated tool carries the new description and scope

### Requirement: Only a published curated tool set is connectable
The system SHALL treat a tool set as connectable only after it has been published, and publishing SHALL be refused unless every enabled mutating tool has an assigned scope and at least one tool is enabled. A draft or un-published curated set MUST NOT be connectable.

#### Scenario: Draft is not connectable
- **WHEN** a tool set is still a draft (not published)
- **THEN** it is not connectable

#### Scenario: Publish refused when an enabled mutating tool lacks a scope
- **WHEN** a curated set contains an enabled mutating tool with no assigned scope and publish is attempted
- **THEN** publishing is refused with a violation and the set remains non-connectable

#### Scenario: Published set is connectable
- **WHEN** a curated set with all enabled mutating tools scoped (and at least one tool enabled) is published
- **THEN** it becomes connectable and serves exactly the curated tools

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

### Requirement: A published flow is exposed as a long-running MCP tool
The system SHALL expose a tenant's published flow as an MCP tool whose input schema is the flow's input contract and which is marked as long-running (executed via the Tasks extension), and invoking the tool SHALL start a flow execution and return a Task handle keyed by the execution id without holding a synchronous connection.

#### Scenario: Invoking a flow tool starts a Task
- **WHEN** a client calls the MCP tool for a published flow
- **THEN** a flow execution is started and the call returns a Task handle identifying that execution

#### Scenario: Flow input schema is the tool input schema
- **WHEN** the tool for a published flow is listed
- **THEN** its input schema matches the flow's declared input contract and it is marked long-running

### Requirement: Flow execution status maps to MCP Task status
The system SHALL map a flow execution's status to an MCP Task status — running to working, completed to completed (with the result), failed to failed (with the error), cancelled to cancelled — readable by polling the execution and observable via the existing events stream.

#### Scenario: Running execution reports working
- **WHEN** the Task for a still-running flow execution is polled
- **THEN** it reports a working status

#### Scenario: Completed execution returns the result
- **WHEN** the flow execution completes and the Task is polled
- **THEN** it reports completed and returns the structured result

### Requirement: Flow tools are tenant-scoped
The system SHALL derive the tenant/workspace for a flow tool from the verified credential, never from tool arguments, and apply the tenant's flow quotas.

#### Scenario: Tenant is credential-derived
- **WHEN** a flow tool is invoked
- **THEN** the execution is scoped to the credential-derived tenant/workspace, regardless of any tenant value in the arguments

### Requirement: Per-tenant MCP server registry with digest-pinned versions
The system SHALL maintain a per-tenant registry of MCP servers in which every server version is pinned by an immutable image digest and carries its manifest and source, and registry entries SHALL be tenant-scoped so that a read with a different tenant identity does not return another tenant's entry.

#### Scenario: A version is registered pinned by digest
- **WHEN** a server version is registered with an image referenced only by a mutable tag (no digest)
- **THEN** the registration is rejected and no version is recorded

#### Scenario: Registry entries are tenant-scoped
- **WHEN** a registry entry is read with a tenant identity other than the one that owns it
- **THEN** the lookup returns nothing and never another tenant's entry

### Requirement: Image signature and supply-chain verification at deploy
The system SHALL reject deploying an MCP server image that is unpinned, from a registry not on the allow-list, or whose signature has not been verified, applying the same image supply-chain rules as the platform's deployable images.

#### Scenario: Unsigned image is rejected
- **WHEN** a deploy is attempted for an image whose signature did not verify
- **THEN** the deploy is rejected with a signature-verification violation

#### Scenario: Unpinned image is rejected
- **WHEN** a deploy is attempted for an image pinned only to the mutable `latest` tag
- **THEN** the deploy is rejected with an image-not-pinned violation

### Requirement: A version bump that changes tool descriptions or scopes requires review before serving
The system SHALL compute the difference in tools, descriptions, and scopes between a server's active version and a new version, and WHEN any tool-facing change is present the new version SHALL be marked as requiring review and SHALL NOT serve traffic until a tenant explicitly approves it.

#### Scenario: Changed tool description is held for review
- **WHEN** a new server version changes a tool's description or scope relative to the active version
- **THEN** the new version is marked as requiring review and cannot be activated until approved

#### Scenario: Approved version serves traffic
- **WHEN** a tenant approves a review-required version
- **THEN** the version can be activated and serves traffic

### Requirement: Rollback to a previously pinned version
The system SHALL allow rolling back to a previously approved, digest-pinned version of a server, re-activating it without requiring a new review.

#### Scenario: Rollback re-activates a prior pinned version
- **WHEN** a tenant rolls back a server to an earlier approved version
- **THEN** that version becomes active by its retained digest without a new review

### Requirement: MCP server detail surfaces endpoint, version and curated tools
The system SHALL present, for a published MCP server, its endpoint, status, active version, and the curated list of tools the server exposes.

#### Scenario: Detail shows endpoint, version and tools
- **WHEN** a tenant opens a published MCP server's detail page
- **THEN** the endpoint, the active version, and the curated tool list are shown

### Requirement: Connect tab renders one-click and copy-paste client configuration
The system SHALL render, in a Connect tab, a one-click "Add to Cursor" deeplink and copy-paste configuration snippets for Claude Code, claude.ai custom connectors, and VS Code, all targeting the server's Streamable-HTTP endpoint without embedding a static secret.

#### Scenario: Cursor deeplink and client snippets are available
- **WHEN** a tenant opens the Connect tab of a server with a published endpoint
- **THEN** a Cursor install deeplink and Claude Code, claude.ai, and VS Code configuration snippets are rendered for that endpoint

#### Scenario: No static secret is embedded
- **WHEN** the connect snippets are rendered
- **THEN** none contains a static secret and each indicates that authentication uses the tenant's OAuth flow

### Requirement: Playground invokes a tool through the OAuth flow and shows the result
The system SHALL let a tenant invoke a curated tool from a playground by supplying JSON arguments, sending an authenticated tool call through the tenant's OAuth flow, and SHALL display the structured result; it SHALL refuse to build a call without a valid access token or endpoint.

#### Scenario: A tool call returns a structured result
- **WHEN** a tenant invokes a curated tool with valid JSON arguments from the playground
- **THEN** the call is sent authenticated with the tenant's access token and the structured result is displayed

#### Scenario: A call cannot be made without authentication
- **WHEN** a tool call is built without a valid OAuth access token
- **THEN** the call is refused

### Requirement: Each MCP tool call produces an attributed log line and latency metric
The system SHALL produce, for each MCP tool call, a usage metric and a latency observation and a structured log line attributed to the tenant, workspace, server, tool, and OAuth client, using only bounded labels (no personally-identifying or high-cardinality labels).

#### Scenario: A tool call is attributed across tenant, server, tool and OAuth client
- **WHEN** an MCP tool call completes
- **THEN** a usage metric, a latency observation, and a log line are produced carrying the tenant, server, tool, and OAuth-client attribution

#### Scenario: Telemetry carries no forbidden label
- **WHEN** MCP tool-call telemetry is produced
- **THEN** it contains none of the forbidden personally-identifying or high-cardinality labels

### Requirement: Per-OAuth-client MCP audit trail is tenant-scoped and queryable
The system SHALL record MCP governance events (OAuth client and server lifecycle) as audit events in the `mcp` audit subsystem with actor, scope envelope, resource, action, and result, and SHALL expose them through a tenant-scoped audit query so that one tenant cannot read another tenant's MCP audit records.

#### Scenario: An OAuth-client event is recorded for the mcp subsystem
- **WHEN** an MCP OAuth-client lifecycle action occurs
- **THEN** an audit event is recorded in the `mcp` subsystem with the OAuth client as actor and the tenant in the scope envelope

#### Scenario: A cross-tenant audit probe returns nothing
- **WHEN** a tenant queries MCP audit records with another tenant's identifier in the request
- **THEN** the query is scoped to the requesting tenant and no other tenant's records are returned

### Requirement: MCP metrics and audit conform to the observability contracts
The system SHALL define the MCP usage metric family and the `mcp` audit subsystem within the platform observability and audit contracts, and these definitions SHALL satisfy the observability validators.

#### Scenario: MCP observability contracts validate
- **WHEN** the observability and audit contract validators run
- **THEN** the MCP metric family and audit subsystem are present and the validators pass

### Requirement: A hosted MCP server is isolated to its tenant
The system SHALL host each MCP server as an internal-only workload reachable only through the gateway, with egress constrained so it cannot reach another tenant's services, and SHALL ensure a cross-tenant probe of the server endpoint, its tools, its logs, or its OAuth credentials does not succeed.

#### Scenario: Cross-tenant probe is denied
- **WHEN** a caller in one tenant attempts to reach another tenant's MCP server endpoint, tools, logs, or OAuth credentials
- **THEN** the attempt does not succeed

#### Scenario: Server egress cannot reach another tenant
- **WHEN** an MCP server pod attempts to connect to another tenant's namespace or services
- **THEN** the network policy constrains egress to DNS and the platform namespace, so the connection is not permitted (under a policy-enforcing CNI)

### Requirement: Per-tenant MCP quotas and rate limits are enforced and audited
The system SHALL enforce per-tenant quotas on running servers and on tools per server, and rate limits on tool calls per minute per server and per OAuth client, honoring an enforcement mode (enforced or unbounded); a breach SHALL return the correct enforcement response and be recorded as an audit event, and rate-limit accounting SHALL be scoped per tenant so one tenant's traffic never consumes another's budget.

#### Scenario: Quota breach returns the enforcement response and is audited
- **WHEN** a tenant exceeds its running-server or per-server tool quota under the enforced mode
- **THEN** the operation is rejected with a quota-exceeded response and an audit event is recorded

#### Scenario: Rate-limit breach is per-server and per-OAuth-client
- **WHEN** tool calls for a server or an OAuth client exceed the per-minute rate limit under the enforced mode
- **THEN** the call is rejected with a rate-limited response carrying a retry hint and an audit event is recorded

#### Scenario: Rate budgets do not cross tenants
- **WHEN** two tenants use the same server or OAuth client identifier
- **THEN** their rate-limit budgets are independent and one tenant's traffic does not consume or reveal the other's

### Requirement: Idle MCP servers scale to zero
The system SHALL scale an idle MCP server to zero replicas and cold-start it on demand, so an unused server incurs no running cost.

#### Scenario: Idle server scales to zero and resumes on demand
- **WHEN** an MCP server is idle
- **THEN** it scales to zero replicas and cold-starts on the next request

### Requirement: The CLI scaffolds a runnable MCP server per language
The system SHALL provide a `falcone mcp init <language>` command that scaffolds a runnable MCP server for TypeScript, Python, or Go, and SHALL reject an unsupported language.

#### Scenario: init scaffolds a runnable server
- **WHEN** a user runs `falcone mcp init` for a supported language
- **THEN** a runnable MCP server project (entrypoint, manifest, run command) is produced for that language

#### Scenario: Unsupported language is rejected
- **WHEN** a user runs `falcone mcp init` for an unsupported language
- **THEN** the command fails with a clear error and a non-zero exit code

### Requirement: The CLI runs a local dev loop against the tenant context
The system SHALL provide a `falcone mcp dev` command that prepares a local run plus a tunnel and MCP Inspector bound to the caller's tenant and workspace.

#### Scenario: dev binds to the credential's tenant/workspace
- **WHEN** a user runs `falcone mcp dev` with a valid credential and workspace
- **THEN** the dev plan runs the server locally and exposes a tunnel and Inspector scoped to that tenant and workspace

### Requirement: The CLI deploys to the runtime and prints the endpoint
The system SHALL provide a `falcone mcp deploy` command that submits an image or source to the control-plane runtime within the caller's workspace and reports the resulting endpoint.

#### Scenario: deploy targets the credential workspace and prints the endpoint
- **WHEN** a user runs `falcone mcp deploy` with an image or source
- **THEN** the request is sent to the caller's workspace-scoped runtime route with the credential, and the endpoint is reported

### Requirement: The CLI authenticates with Falcone credentials and cannot cross tenants
The system SHALL authenticate CLI commands with the Falcone credential and SHALL refuse any command that attempts to target a tenant other than the credential's tenant.

#### Scenario: Unauthenticated command is rejected
- **WHEN** a credential-requiring command runs without a Falcone credential
- **THEN** it fails with a not-authenticated error and a non-zero exit code

#### Scenario: Cross-tenant target is refused
- **WHEN** a command is invoked targeting a tenant other than the credential's tenant
- **THEN** the command is refused

### Requirement: The SDK injects tenant-scoped data clients into tool handlers
The system SHALL provide a server SDK that injects, into each tool handler, clients for the tenant's database, storage, functions, and events, pre-bound to the tenant and workspace resolved from the verified credential, so a tool reads or writes the tenant's data in a few lines.

#### Scenario: A tool reads the tenant database in a few lines
- **WHEN** a tool handler calls the injected database client
- **THEN** the request is automatically scoped to the credential's tenant and workspace

#### Scenario: Scope comes from the credential, not the tool arguments
- **WHEN** a tool is invoked
- **THEN** the injected clients are bound to the tenant resolved from the verified request, regardless of any tenant value in the tool arguments

### Requirement: A tool cannot escape its injected tenant scope
The system SHALL force the bound tenant and workspace onto every client request and SHALL expose no API to widen or change the injected scope, so a tool cannot access another tenant's data.

#### Scenario: Bound scope is authoritative on every call
- **WHEN** a tool passes tenant-looking values in its arguments or call data
- **THEN** the authoritative request scope remains the credential-bound tenant and workspace

#### Scenario: The injected context cannot be mutated
- **WHEN** a tool attempts to replace a client or change the scope on the injected context
- **THEN** the attempt has no effect (the context is immutable)

### Requirement: The SDK wraps the official MCP SDK in at least two languages
The system SHALL wrap the official MCP server SDK and SHALL be available for TypeScript and at least one of Python or Go.

#### Scenario: The SDK registers tools on an official MCP server
- **WHEN** a tool is declared through the SDK
- **THEN** it is registered on the underlying official MCP server with the tenant-scoped context injected

### Requirement: MCP has a real-stack E2E suite following the repo conventions
The system SHALL provide Playwright E2E specs for the MCP capability that deploy into an ephemeral namespace on the kind cluster and are always torn down, covering the full loop, cross-tenant isolation, and version-pinning, with a per-issue runner entry.

#### Scenario: The MCP E2E suite is runnable and tears down
- **WHEN** the MCP E2E suite is run via the standard runner
- **THEN** the stack is deployed into an ephemeral namespace and the namespace is always removed afterward

#### Scenario: Full loop, cross-tenant, and version-pinning are covered
- **WHEN** the MCP E2E specs are listed
- **THEN** they include the full loop (create → curate → deploy → connect → call → observe), cross-tenant isolation probes, and a version-pinning review check

### Requirement: MCP E2E specs gate honestly on the live management API
The system SHALL probe whether the control-plane serves the MCP management API and, when it is not served, SHALL skip the dependent specs with a precise reason rather than failing or reporting a false pass.

#### Scenario: Specs skip with a reason when the management API is absent
- **WHEN** the MCP E2E specs run against a control-plane that does not serve the MCP management API
- **THEN** the specs are skipped with a reason naming the missing capability, and none fail

#### Scenario: Cross-tenant probes deny tenant B against tenant A
- **WHEN** the management API is served and tenant B probes tenant A's server, tools, or audit
- **THEN** each probe is denied or empty, proving isolation

### Requirement: MCP has a tenant guide in the docs-site
The system SHALL publish a tenant guide for MCP server hosting covering the server sources (Instant, custom, official), mandatory curation, connecting clients with working snippets, the CLI, and the Server SDK.

#### Scenario: The guide covers sources, connection, and the SDK
- **WHEN** a tenant reads the MCP guide
- **THEN** it explains Instant MCP / custom hosting / the official server, how to connect Cursor / Claude Code / claude.ai / VS Code, and how to write a tool with the Server SDK

### Requirement: MCP has internal architecture and runbook docs linked in the nav
The system SHALL publish an internal architecture document and an operational runbook for MCP, linked in the docs-site navigation and cross-linked to the MCP ADR.

#### Scenario: Architecture and runbook are published and linked
- **WHEN** the docs-site is built and navigated
- **THEN** the MCP architecture doc and runbook are present in the sidebar and cross-link to ADR-12

#### Scenario: The docs-site build is green with no dead links
- **WHEN** the docs-site is built
- **THEN** the build succeeds and reports no dead links

### Requirement: The control-plane runtime serves the MCP management API
The system SHALL serve the MCP server management API from the live control-plane runtime under `/v1/mcp/workspaces/{workspaceId}/servers`, supporting create, retrieve, list, curate, publish a version, approve a version, invoke a tool, read the audit, and delete — gated on the MCP capability being enabled.

#### Scenario: The full management loop works end to end
- **WHEN** a tenant creates a server, curates it, publishes a version, retrieves it, invokes a tool, and reads the audit through the runtime
- **THEN** each step succeeds and the retrieved server reports its endpoint, active version, and curated tools

#### Scenario: MCP routes are absent when the capability is disabled
- **WHEN** the MCP capability is not enabled
- **THEN** the runtime registers no `/v1/mcp` routes

### Requirement: MCP management is tenant-scoped on the live runtime
The system SHALL derive the tenant and workspace for every MCP management request from the verified credential and SHALL ensure a tenant cannot read, invoke, audit, or list another tenant's server.

#### Scenario: Cross-tenant access is denied
- **WHEN** a tenant requests another tenant's server detail, tool call, or audit
- **THEN** the request is denied as not found and the other tenant's server never appears in the requester's list

### Requirement: MCP quotas and rate limits are enforced on the live runtime
The system SHALL enforce the per-tenant MCP quotas and rate limits on the management API, returning the correct enforcement response on a breach.

#### Scenario: Server-count quota breach is rejected
- **WHEN** creating a server would exceed the tenant's running-server quota under the enforced mode
- **THEN** the request is rejected with a quota-exceeded response identifying the breached dimension

### Requirement: A version bump that changes tool descriptions is held for review on the live runtime
The system SHALL hold a new server version that changes a tool's description or scope for review and SHALL keep serving the previously approved version until the new version is approved.

#### Scenario: Unapproved change is not served, then serves after approval
- **WHEN** a tenant publishes a version that changes a tool description and then approves it
- **THEN** the prior version keeps serving until approval, after which the new version serves

### Requirement: MCP documentation reflects the live management API
The system SHALL document that the control-plane runtime serves the MCP management API under `/v1/mcp`, with concrete examples that match the real endpoint shapes and the runtime engine, including an end-to-end create → curate → publish → call → observe walkthrough and an example tool definition.

#### Scenario: MCP docs show the live API with a working example
- **WHEN** a reader views the MCP guide
- **THEN** the real `/v1/mcp/workspaces/{workspaceId}/servers` route table and an end-to-end example are shown, matching the implemented runtime

### Requirement: MCP documentation states accurate per-layer status
The system SHALL label each MCP layer with its real status — Instant MCP and the official server as Preview (live), and custom (bring-your-own-image) hosting and workflows-as-MCP-tools as Experimental (built but not on the live create path) — and SHALL note that server state is in-memory.

#### Scenario: Each layer carries an accurate status label
- **WHEN** a reader views the MCP guide or architecture page
- **THEN** instant/official are labelled Preview and custom-hosting/workflows-as-tools are labelled Experimental, with the in-memory state noted

### Requirement: The roadmap distinguishes shipped from planned
The system SHALL present shipped capabilities (Flows, MCP) as Preview and SHALL keep genuinely-future items as planned, including object-storage / document-DB alternatives that are not yet implemented in the repository.

#### Scenario: The roadmap reflects the real state
- **WHEN** a reader views the roadmap
- **THEN** Flows and MCP are shown as shipped Preview, and unimplemented items (including the SeaweedFS / FerretDB+DocumentDB alternatives) are clearly marked planned and under evaluation

### Requirement: MCP tool-calls return the executor index instead of executing

The system SHALL ensure that mCP tool-calls return the executor index instead of executing is corrected: Set `MCP_SELF_BASE_URL`, fix the instant tool request templates, and route official/platform tools to the control-plane.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A hosted tool-call performs the real action and returns its result

### Requirement: MCP->workflow mapping orphaned; platform MCP non-functional

The system SHALL ensure that mCP->workflow mapping orphaned; platform MCP non-functional is corrected: Wire the flow-backed tool generator into the MCP engine; make the platform MCP tools call the control-plane.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An MCP tool starts a workflow and returns its result

### Requirement: Platform MCP server is reachable over HTTP (JSON-RPC)

The system SHALL expose the platform (first-party) MCP server over an authenticated HTTP JSON-RPC
endpoint (`POST /v1/mcp/rpc`) so a standard MCP client can `initialize`, `tools/list`, and
`tools/call` the official Falcone management tools. The endpoint SHALL require an authenticated
caller (no trusted identity → `401`). The tenant SHALL be derived from the verified credential and
NEVER from tool arguments. A `tools/call` SHALL be authorized from the caller's verified token
scopes — the base scope `mcp:invoke` is required, and a mutating tool additionally requires its
declared per-tool scope; an unauthorized call SHALL return a JSON-RPC error without invoking the
control-plane. Tool invocations SHALL be executed against the control-plane on the caller's behalf,
forwarding the caller's bearer credential.

#### Scenario: MCP client initializes and lists tools

- **WHEN** an authenticated caller POSTs a JSON-RPC `initialize` (then `tools/list`) to `/v1/mcp/rpc`
- **THEN** the server returns its protocol version + server info, and the official tool catalog

#### Scenario: a read tool proxies to the control-plane on the caller's behalf

- **WHEN** an authenticated caller with the `mcp:invoke` scope calls a read tool (e.g. `list_workspaces`)
- **THEN** the platform MCP calls the corresponding control-plane route forwarding the caller's bearer, and returns the result as tool content

#### Scenario: a mutating tool without its scope is refused

- **WHEN** a caller invokes a mutating tool (e.g. `create_workspace`) without the tool's declared scope
- **THEN** the response is a JSON-RPC error and no control-plane call is made

#### Scenario: unauthenticated access is rejected

- **WHEN** a request carries no trusted identity
- **THEN** the response is `401`

### Requirement: Hosted MCP servers expose the standard JSON-RPC wire protocol

A published, hosted per-workspace MCP server SHALL be reachable by a standard external MCP client over
the JSON-RPC 2.0 wire protocol at `POST /v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc`,
supporting the `initialize`, `tools/list`, `tools/call`, and `ping` methods so the client can discover
and invoke the server's curated tools. The request body is the JSON-RPC message; the HTTP status is
`200` for a request (the JSON-RPC envelope carries success or error) and `202` for a notification
(no `id`).

The tenant and workspace SHALL always be derived from the verified caller identity and the URL
`serverId`, never from the JSON-RPC message. A server created by one tenant SHALL be invisible to
every other tenant (its lookup resolves to a JSON-RPC error, leaking no server metadata). A request
with no verified identity SHALL be rejected with HTTP `401` before reaching the protocol handler.

Tool-call authorization (the base `mcp:invoke` scope plus a mutating tool's explicit scope), quotas,
rate limiting, telemetry, and the per-tenant audit trail SHALL be enforced identically to the
existing REST tool-call path; a scope failure surfaces as a tool-level `isError` result per MCP
convention, not as a JSON-RPC protocol error.

#### Scenario: A standard MCP client lists and calls a hosted tool over the protocol

- **WHEN** an MCP client sends `initialize` to a published hosted server's `/rpc` endpoint with a
  valid tenant identity
- **THEN** the server responds `200` with `result.protocolVersion`, `result.serverInfo.name`, and
  `result.capabilities.tools`
- **AND WHEN** the client sends `tools/list`
- **THEN** the response lists the server's published tools, each with a `name` and an `inputSchema`
- **AND WHEN** the client sends `tools/call` for a read tool
- **THEN** the call is executed against the real backing route (workspace bound to the credential)
  and the response carries the tool `content` with `isError: false`

#### Scenario: Cross-tenant access to a hosted server is rejected without leaking metadata

- **WHEN** a caller authenticated for tenant B sends `initialize` to a server owned by tenant A
- **THEN** the response is a JSON-RPC error and contains no `serverInfo` for tenant A's server
- **AND WHEN** a caller presents no verified identity
- **THEN** the request is rejected with HTTP `401`

#### Scenario: Notifications are acknowledged without a response body

- **WHEN** the client sends a JSON-RPC notification (e.g. `notifications/initialized`, no `id`)
- **THEN** the server responds `202` with no JSON-RPC response body

