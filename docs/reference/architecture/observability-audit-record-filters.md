# Observability Audit Record Filters

The audit-record list routes expose the filter surface declared by the observability audit query
contract:

- `GET /v1/metrics/tenants/{tenantId}/audit-records`
- `GET /v1/metrics/workspaces/{workspaceId}/audit-records`

Both routes accept `page[size]` and the audit filters used by the web console:

- `filter[outcome]`
- `filter[actionCategory]`
- `filter[actorId]`
- `filter[occurredAfter]`
- `filter[occurredBefore]`

Filters are conjunctive. The control plane applies them inside the already resolved tenant or
workspace scope before ordering and limiting the result set. A filter value that matches no audit
rows returns an empty page; it must not fall back to the full unfiltered audit set.

Example:

```http
GET /v1/metrics/tenants/{tenantId}/audit-records?page[size]=50&sort=-eventTimestamp&filter[outcome]=failed&filter[actorId]=user-123
```

That request returns at most 50 tenant-scoped audit records whose outcome is `failed` and whose
actor id is `user-123`.

For kind control-plane audit rows, `filter[actionCategory]` matches the stored audit action
category when present and also remains compatible with rows that only have a stored `action_type`
such as `tenant.user.create`.
