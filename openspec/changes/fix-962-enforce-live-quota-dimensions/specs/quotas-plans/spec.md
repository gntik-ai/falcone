## ADDED Requirements

### Requirement: Live tenant dimensions bind at their resolved limits

The control plane SHALL resolve `max_kafka_topics`, `max_mongo_databases`,
`max_functions` and `max_storage_bytes` using the existing active override, plan
and catalog default precedence. Authorization and ownership checks SHALL precede
quota evaluation. Denied requests SHALL return `402 QUOTA_EXCEEDED` with the
applicable dimension and usage/limit, before external resource creation or writes.

#### Scenario: Topic admission at the tenant limit

- **GIVEN** a tenant has ten topic registry entries across all its workspaces and
  its resolved catalog topic limit is ten
- **WHEN** it requests an eleventh topic
- **THEN** the control plane refuses the request before Kafka creation or registry
  insertion and records `topic.create` for `max_kafka_topics`, `hard_blocked`,
  source `default`, current usage ten and effective limit ten

#### Scenario: Distinct Mongo database admission

- **GIVEN** a tenant has two distinct registered Mongo database names and a resolved
  database limit of two
- **WHEN** it provisions a third name
- **THEN** the request is refused before creating any FerretDB collection or registry
  entry and records `mongo_database.create` for `max_mongo_databases`
- **AND** re-provisioning an already registered name succeeds without quota evaluation

#### Scenario: Function admission excludes updates

- **GIVEN** a tenant has fifty registered functions and a resolved limit of fifty
- **WHEN** it requests a new Function
- **THEN** the request is refused before Knative deployment, secret resolution or
  registry writes and records `function.create` for `max_functions`
- **AND** PATCH of an existing authorized Function is not quota-gated

#### Scenario: Resolved precedence and unlimited values

- **WHEN** a dimension has an active override or an explicit plan value
- **THEN** that value takes precedence over the catalog, whether it raises or lowers
  the default, allowing usage below the limit and refusing new units at the limit
- **AND** the unlimited sentinel allows admission without an enforcement record

#### Scenario: Authorized creation below the limit

- **WHEN** tenant usage remains below its applicable resolved limit
- **THEN** the existing successful creation response is preserved and no quota
  enforcement record is written

#### Scenario: Foreign workspace access

- **WHEN** a caller requests creation in another tenant's workspace or bucket
- **THEN** the existing `403` or `404` authorization response precedes quota evaluation
  and no external write or quota enforcement record occurs

### Requirement: Storage bytes use tenant-wide catalog admission

Storage byte admission SHALL resolve `max_storage_bytes` through governance even
when `STORAGE_MAX_BYTES` is unset. Usage SHALL sum stored bytes across all tenant
workspaces, following object-list pagination. Partial or failed metering SHALL
remain fail-open as `quota_unavailable`. Admission SHALL be bounded to 100 object
listing pages and five seconds of object-store reads.

#### Scenario: Single upload crosses the resolved byte limit

- **WHEN** a single object upload would increase tenant usage beyond the resolved
  byte limit, including the catalog default of 5368709120
- **THEN** it is refused before S3 PUT and records `storage.upload` for
  `max_storage_bytes` with current tenant usage and the resolved source and limit
- **AND** an exact fill succeeds and replacing an existing object uses net bytes

#### Scenario: Multipart admission precedes completion

- **WHEN** completing an upload would increase tenant usage beyond the byte limit
- **THEN** actual stored S3 part sizes are used for admission before completion
- **AND** no completed object is created or deleted on denial, and one
  `max_storage_bytes` enforcement record is written

#### Scenario: Storage usage reports the resolved limit

- **WHEN** an authorized caller reads workspace storage usage
- **THEN** `totalBytes` reports tenant usage and its resolved catalog, plan or
  override limit, with a null limit only for a resolved unlimited sentinel
- **AND** unavailable governance retains the legacy reporting fallback and
  unavailable metering is identified rather than reported as authoritative zero

#### Scenario: Bucket admission stays independent

- **WHEN** the workspace reaches the existing bucket-count limit
- **THEN** the unchanged bucket admission returns `409 STORAGE_QUOTA_EXCEEDED`

### Requirement: Governance and logging faults preserve availability

New dimension gates SHALL fail open with `quota_unavailable` on governance loader,
resolver or metering failures. Enforcement logging SHALL be best-effort.

#### Scenario: Governance unavailable

- **WHEN** loading or resolving governance fails or usage cannot be metered
- **THEN** resource admission remains available under the existing fail-open policy

#### Scenario: Enforcement log unavailable

- **WHEN** writing the enforcement record fails after deciding to deny
- **THEN** the response remains `402 QUOTA_EXCEEDED` and no external write occurs

### Requirement: Posture distinguishes capabilities without runtime gates

Quotas and overview reports SHALL derive enforcement status from the explicit set
of five runtime dimension gates, including the existing `max_workspaces` gate.
Dimensions without a gate SHALL report `not_enforced`.

#### Scenario: Ungated capability is visible

- **WHEN** a quota or overview report includes `max_flows`, `max_api_keys`,
  `max_pg_databases` or `max_workspace_members`
- **THEN** its policy mode is `not_enforced`, regardless of its finite limit

#### Scenario: Existing workspace governance is preserved

- **WHEN** workspace admission is evaluated
- **THEN** its existing behavior, source resolution and enforcement log remain unchanged
