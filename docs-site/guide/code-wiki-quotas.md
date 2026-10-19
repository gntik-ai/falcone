# Code wiki quotas

Falcone holds code wiki limits on the tenant's plan. The product reports usage
summed across that tenant and enforces Falcone's decision. No usage counters or
reservations are held by this endpoint.

| Dimension | Unit | Catalog default | Usage |
| --- | --- | --- | --- |
| `codewiki_max_projects` | count | 3 | Projects per tenant |
| `codewiki_max_concurrent_runs` | count | 1 | Analysis runs in progress per tenant |
| `codewiki_max_queued_runs` | count | 5 | Runs waiting to start per tenant |
| `codewiki_max_indexed_repositories` | count | 3 | Repositories with a current index per tenant |
| `codewiki_max_wiki_pages` | count | 500 | Pages across current wiki versions per tenant |
| `codewiki_max_repository_bytes` | bytes | 524288000 (500 MiB) | One source snapshot |

Operators set plan values through
`PUT /v1/plans/{planId}/limits/{dimensionKey}` with a body such as
`{"value": 10}`. A plan value takes precedence over the catalog default; `-1`
means unlimited. Per-tenant overrides cannot raise these limits until override
persistence is available (#963). No Free or Paid plan values are seeded here.

## Request a decision

Send `POST /v1/workspaces/{workspaceId}/quota-decisions` with a verified bearer
token and a JSON body. Use the workspace's canonical ID; slugs are not accepted.

```json
{
  "dimensionKey": "codewiki_max_projects",
  "currentUsage": 2,
  "requested": 1,
  "attemptedAction": "project.create"
}
```

`currentUsage` must be a non-negative integer. `requested` is a positive integer
and defaults to 1. `attemptedAction` is optional, contains only lowercase letters,
digits, dots, underscores and hyphens, and is at most 64 characters. Unknown
fields and non-catalog or non-`codewiki_` keys return `400 VALIDATION_ERROR`.

Tenant managers of the workspace's tenant are accepted, as are callers whose
verified tenant matches the workspace's tenant and whose token binds that
workspace. Other callers receive 403; unknown workspaces return 404.

The response is HTTP 200 for both allowed and denied decisions:

```json
{
  "allowed": true,
  "decision": "allowed",
  "dimensionKey": "codewiki_max_projects",
  "quotaType": "hard",
  "effectiveLimit": 3,
  "effectiveCeiling": 3,
  "currentUsage": 2,
  "projectedUsage": 3,
  "source": "default"
}
```

Hard limits allow `currentUsage + requested` up to and including the limit.
Soft limits allow excess usage below the grace ceiling with a `warning`; usage
at or above that ceiling is denied. A denial writes one quota enforcement log
row with tenant, workspace, dimension, attempted action, actor and correlation
ID. Allowed decisions write none. Log write failures do not change a denial.

For `codewiki_max_repository_bytes`, always send `currentUsage: 0` and the
snapshot size in bytes as `requested`. Non-zero usage returns 400. Repeated
400 MiB snapshots are each allowed under the default; a 600 MiB snapshot is
denied. The ceiling applies separately to each request.

Catalog or resolver failure returns `503 QUOTA_UNAVAILABLE`. The product must
fail closed and avoid the attempted action. These product decisions do not
change platform admission gates: the quota posture report still labels
`codewiki_` dimensions `not_enforced`.
