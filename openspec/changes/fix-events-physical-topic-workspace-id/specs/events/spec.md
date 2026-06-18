# events — spec delta for fix-events-physical-topic-workspace-id

## ADDED Requirements

### Requirement: Control-plane physical topic naming is workspace-id scoped

The control-plane events provisioning path SHALL derive the physical Kafka topic
name from the globally-unique workspace id (`evt.<workspaceId>.<topic>`), matching
the executor data-plane, and SHALL NOT derive it from the per-tenant workspace
`slug` (which is not globally unique). The `workspace_topics` mapping SHALL key its
idempotency on `(workspace_id, topic_name)` and SHALL NOT reassign `tenant_id` on
conflict, so a same-slug collision can never hijack another tenant's topic row.

#### Scenario: two same-slug workspaces across tenants get distinct topics

- **WHEN** tenant A and tenant B each provision topic `collide-events` in their
  respective `app-staging` workspaces (same slug, different workspace ids)
- **THEN** each receives a distinct `resourceId` and a distinct physical topic
  (`evt.<workspaceIdA>.collide-events` vs `evt.<workspaceIdB>.collide-events`)
- **AND** neither tenant's `workspace_topics` row is overwritten or its `tenant_id`
  reassigned, and both tenants can use their own topic.

#### Scenario: re-provisioning the same topic is idempotent

- **WHEN** a tenant provisions the same logical topic twice in the same workspace
- **THEN** the second call returns the original `resourceId` (idempotent), keyed on
  `(workspace_id, topic_name)`.
