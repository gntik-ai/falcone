# Structural write role gates

Structural writes are tenant-wide or workspace-wide mutations that change infrastructure,
configuration, credentials, executable definitions, or message topics. Falcone authorizes these
writes by tenant role, not by tenant membership alone.

## Required roles

A structural write requires one of these roles on the verified caller identity:

| Role | Scope |
| --- | --- |
| `tenant_owner` | Owning tenant admin |
| `tenant_admin` | Owning tenant admin |
| `platform_admin` | Platform admin / internal operator |
| `superadmin` | Platform admin / internal operator |

Executor routes also continue to accept the existing write-capable workspace roles where that role set
already applies (`workspace_owner`, `workspace_admin`), but kind control-plane storage and Kafka
handlers use tenant-admin authority because those handlers authorize through tenant ownership.

`tenant_developer` and `tenant_viewer` are non-admin roles. API keys are also not structural-admin
credentials, even when they carry `data:write` or `ddl:write`; those scopes authorize only
non-structural data-plane operations. JWT or trusted-header identities with missing or empty role
claims are likewise not authorized for structural writes. These callers receive `403 FORBIDDEN` and
the handler must perform no persistence or external side effect.

## Covered write paths

The role gate applies to these families:

| Family | Structural writes |
| --- | --- |
| LLM/embedding provider config | `PUT` / `DELETE /v1/workspaces/{workspaceId}/llm-provider`, `PUT` / `DELETE /v1/workspaces/{workspaceId}/embedding-provider` |
| Embedding mapping | `PUT` / `DELETE /v1/postgres/workspaces/{workspaceId}/data/{database}/schemas/{schema}/tables/{table}/embedding-mapping` |
| MCP | Host/delete servers, create curations, publish versions, and approve/reject versions |
| Flows | Create/update/delete definitions and publish versions |
| Storage | Provision/delete buckets, rotate/revoke credentials, object write/delete, presign, multipart, import, and export |
| Events/Kafka | Create topics and publish events |

Read paths, list paths, downloads, and event streams keep their existing tenant membership and
ownership checks unless the operation performs a structural side effect. For example, listing topics
or consuming an event stream is not gated by this rule, but creating a topic or publishing an event is.

## Workspace scope

Workspace-scoped structural writes must also honor verified `workspaceIds` when the identity carries
them. A caller scoped away from the requested workspace receives `403 FORBIDDEN`. A structural write
to an unknown workspace receives `404 WORKSPACE_NOT_FOUND` and must not create executor-side phantom
resources under that UUID.

Cross-tenant ordering still takes precedence. If a caller addresses a resource owned by another
tenant, the existing cross-tenant or not-found response is returned before role details are exposed.

## Console behavior

The Events console must not offer create-topic or publish controls to non-admin roles. The backend
gate remains authoritative: if a non-admin caller reaches the API directly, the write is denied with
`403 FORBIDDEN` and nothing is created or published.
