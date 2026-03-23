# Internal Service Map Notes

This note explains the baseline recorded in `services/internal-contracts/src/internal-service-map.json`.

## Service boundaries

### `control_api`

Owns:

- public HTTP contract and route versioning
- request validation and authorization context
- translation from REST intent to internal command envelopes
- synchronous acceptance/rejection semantics

Must not own:

- provider-specific workflows
- long-running provisioning state machines
- provider SDK/client code

### `provisioning_orchestrator`

Owns:

- orchestration of multi-provider provisioning work
- idempotent provisioning-run correlation
- step sequencing and outcome aggregation
- retryability/terminal-failure classification

Must not own:

- public REST concerns
- provider SDK details
- audit storage/query implementation details

### `audit_module`

Owns:

- append-only audit evidence capture
- evidence correlation for control and provisioning actions
- redaction and evidence-pointer policy

Must not own:

- request routing
- orchestration sequencing
- provider-specific lifecycle behavior

### `services/adapters`

Owns:

- provider-facing port definitions
- translation between provider APIs and shared adapter envelopes
- provider-specific retries/timeouts/credential handling in later tasks

Must not own:

- control-plane business rules
- orchestration policy
- audit policy

## Dependency rules

Allowed baseline dependency directions:

- `control_api` -> `provisioning_orchestrator`
- `control_api` -> `audit_module`
- `provisioning_orchestrator` -> `audit_module`
- `provisioning_orchestrator` -> adapter ports
- `audit_module` -> selected adapter ports (`postgresql`, `storage`) for evidence persistence

Disallowed baseline dependency directions:

- `control_api` -> provider adapters directly
- provider adapters -> `control_api`
- provider adapters -> `provisioning_orchestrator`
- `audit_module` -> `control_api`
- circular service-to-service dependencies

## Contract intent summary

| Contract | Produced by | Consumed by | Why it exists |
|----------|-------------|-------------|---------------|
| `control_api_command` | `control_api` | `provisioning_orchestrator`, `audit_module` | Captures accepted control intent in a stable internal envelope |
| `provisioning_request` | `control_api` or future schedulers | `provisioning_orchestrator` | Starts or resumes idempotent provisioning work |
| `provisioning_result` | `provisioning_orchestrator` | `control_api`, `audit_module`, future status readers | Normalizes orchestration outcomes |
| `adapter_call` | `provisioning_orchestrator`, `audit_module` | provider ports | Standardizes provider-facing requests |
| `adapter_result` | provider ports | `provisioning_orchestrator`, `audit_module` | Standardizes provider-facing responses and failure classes |
| `audit_record` | `control_api`, `provisioning_orchestrator` | `audit_module` | Creates append-only evidence |

## Baseline flows

### Tenant provisioning

1. `control_api` validates the request and emits `control_api_command` / `provisioning_request`.
2. `provisioning_orchestrator` creates or reloads a provisioning run using the `idempotency_key`.
3. The orchestrator invokes adapter ports for identity, relational data, document data, messaging, functions, and storage.
4. `audit_module` records acceptance, step changes, and the terminal outcome.

### Tenant suspension / deactivation

1. `control_api` accepts the action and emits a versioned command.
2. `provisioning_orchestrator` coordinates provider-facing disable/suspend capabilities.
3. `audit_module` records the request, affected scope, and final outcome.

## Extension constraints

- New providers should be modeled as new adapter ports or additional capabilities on existing ports.
- New modules should depend on `services/internal-contracts` rather than reaching into another module's implementation details.
- Breaking contract changes must update the contract version and include a migration note in a future task.
