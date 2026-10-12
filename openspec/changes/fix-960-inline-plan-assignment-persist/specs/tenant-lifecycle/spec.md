## MODIFIED Requirements

### Requirement: Inline plan assignment

POST /v1/tenants SHALL support best-effort inline plan assignment after tenant persistence. The
helper SHALL resolve a plan slug to its catalog UUID and SHALL acquire one dedicated client with
pool.connect() when the supplied handle supports it. Slug lookup and every plan-assign statement
SHALL run on that same client. insertWithHistory SHALL retain ownership of BEGIN/COMMIT/ROLLBACK;
assigned=true SHALL be reported only after assignment and history have committed. The helper SHALL
release an acquired client exactly once in finally and SHALL NOT release a borrowed plain client.

Unknown slugs, inactive plans, assignment errors, acquisition errors and release errors SHALL NOT
throw from the helper, abort tenant creation or initiate saga rollback. An unfulfilled assignment
SHALL return assigned=false with a reason, while tenant creation retains its 201 response.
Acquisition errors SHALL use a generic reason and SHALL NOT expose credentials or connection
strings. Other tenant-creation steps SHALL continue using the original pool.

#### Scenario: Active plan UUID persists before success

- **GIVEN** an active plan
- **WHEN** POST /v1/tenants supplies its planId
- **THEN** the response is 201 with planAssignment.assigned=true
- **AND** GET /v1/tenants/{id}/plan returns that assignmentId and plan
- **AND** GET /v1/tenants/{id}/plan/history has total=1 and the returned historyEntryId

#### Scenario: Active slug resolves and persists

- **GIVEN** a resolvable active plan slug
- **WHEN** POST /v1/tenants supplies the slug as planId
- **THEN** slug lookup and assignment use one dedicated client
- **AND** the resolved UUID, assignmentId and historyEntryId are observable in follow-up reads
- **AND** the client is released exactly once

#### Scenario: Inactive plan remains best-effort

- **GIVEN** a draft plan
- **WHEN** POST /v1/tenants supplies its planId
- **THEN** the tenant is persisted and the response is 201 with assigned=false
- **AND** the reason is 'Plan is not active' and no assignment row exists
- **AND** the client is released exactly once

#### Scenario: Unknown slug or assignment failure does not roll back the tenant

- **WHEN** slug lookup finds no plan or plan-assign throws
- **THEN** the tenant is persisted and the response is 201 with assigned=false and a reason
- **AND** no 5xx or saga rollback occurs
- **AND** the client is released exactly once and no connection remains idle in an open transaction

#### Scenario: Acquisition failure remains best-effort

- **WHEN** pool.connect() rejects
- **THEN** tenant creation succeeds with assigned=false and a generic reason
- **AND** no assignment is attempted and no client is released

#### Scenario: Failure before plan-assign still releases

- **WHEN** a loader or slug lookup throws after acquiring a client but before invoking plan-assign
- **THEN** assigned=false is returned and the client is released exactly once

#### Scenario: Release failure cannot abort creation

- **WHEN** release throws or rejects after success or failure
- **THEN** the helper retains the assignment outcome without throwing
- **AND** release is attempted exactly once

#### Scenario: Borrowed plain client retains caller ownership

- **GIVEN** a handle without connect()
- **WHEN** inline plan assignment runs
- **THEN** lookup and assignment use that handle directly and the helper never releases it
