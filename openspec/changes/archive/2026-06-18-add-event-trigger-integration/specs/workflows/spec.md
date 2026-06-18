# workflows — spec delta for add-event-trigger-integration

## ADDED Requirements

### Requirement: Published events trigger the bound flow execution end-to-end

The system SHALL consume a published platform event off its tenant-scoped physical topic
(`evt.{workspaceId}.{eventType}`) and start the bound flow's execution through the same
start path as a manual or webhook trigger, stamping `triggerType=platform_event`.

The platform-event consumer SHALL be started on process boot for platform-event trigger
registrations that already exist in the trigger store (e.g. a flow published in a prior
process, then the pod rolled), so a matching event published after a restart still starts the
bound flow rather than being silently dropped.

The deploy SHALL register the five custom Temporal search attributes (`tenantId`,
`workspaceId`, `flowId`, `flowVersion`, `triggerType`, all `Keyword`) that the flow executor
stamps on every workflow start AND queries in its concurrency pre-flight, so that a manual or
event-triggered start does not fail on a Temporal visibility error before any run starts.

#### Scenario: a published event consumed off the bound topic starts the bound flow

- **WHEN** a platform-event trigger flow is published (binding the workspace topic
  `evt.{workspaceId}.{eventType}`) and a matching event is then published to that topic
- **THEN** the event-trigger consumer starts exactly one execution of the bound flow, stamped
  `triggerType=platform_event` and scoped to the bound tenant/workspace

#### Scenario: a process restart re-wires the consumer to pre-existing registrations

- **WHEN** the flow's platform-event trigger was registered in a prior process and the runtime
  is restarted (no new publish in the new process)
- **THEN** the boot wiring subscribes the consumer to the persisted registration's topic and a
  subsequent matching event starts the bound flow

#### Scenario: a redelivered Kafka offset starts only one execution

- **WHEN** the same Kafka message (topic/partition/offset) is delivered to the consumer twice
- **THEN** only one flow execution is started (the deterministic dedup key makes the redelivery
  an idempotent no-op)

#### Scenario: an event on a foreign-tenant workspace topic starts nothing

- **WHEN** an event is delivered on a workspace topic that no registration in this tenant
  subscribes to (a foreign `evt.{otherWorkspaceId}.{eventType}`)
- **THEN** no execution is started (structural cross-tenant denial: a registration is matched
  only by its own tenant/workspace-embedded physical topic)

#### Scenario: the deploy registers the Temporal search attributes the executor relies on

- **WHEN** the kind advanced overlay (the live-failing config) is rendered
- **THEN** the Temporal bootstrap Job registers exactly the five Keyword search attributes
  (`tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`) as a
  post-install,post-upgrade hook
