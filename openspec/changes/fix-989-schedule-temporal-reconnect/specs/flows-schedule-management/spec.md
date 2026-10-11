## MODIFIED Requirements

### Requirement: Temporal client lifecycle

The schedule plane SHALL discard rejected Temporal connection attempts, share in-flight
attempts and reuse successful clients. Connect-phase failures SHALL be classified as
503 TEMPORAL_UNAVAILABLE. Original SDK diagnostics SHALL appear only in server logs.

#### Scenario: Recovery after a failed connection

- **WHEN** the first connection attempt rejects and the next attempt succeeds
- **THEN** the first schedule call fails with 503 TEMPORAL_UNAVAILABLE
- **AND** the next call attempts a fresh connection and succeeds without restarting the process

#### Scenario: Repeated connection failures

- **WHEN** Temporal remains unreachable across sequential schedule calls
- **THEN** every call makes a fresh connection attempt
- **AND** no call receives a cached rejected connection promise

#### Scenario: Concurrent connection requests

- **WHEN** multiple callers request a client while a connection attempt is pending
- **THEN** those callers share exactly one connection attempt

#### Scenario: Successful client reuse

- **WHEN** a connection attempt succeeds
- **THEN** later schedule calls reuse that client without dialing again

### Requirement: Schedule-management availability responses

GET schedule, list schedules, pause, resume and trigger SHALL return HTTP 503 with code
TEMPORAL_UNAVAILABLE when connecting to Temporal fails. The response SHALL contain no
SDK error text, backend address or stack trace. Existing publicErrorCode redaction rules
SHALL remain unchanged.

#### Scenario: Safe connect failure envelope

- **WHEN** any schedule-management route encounters a rejected connection attempt
- **THEN** the response is 503 TEMPORAL_UNAVAILABLE with a generic public message
- **AND** the original error is logged server-side

#### Scenario: Trigger plane is disabled

- **WHEN** the trigger plane is not wired
- **THEN** schedule-management routes retain 501 FLOW_SCHEDULING_DISABLED

#### Scenario: Schedule does not exist

- **WHEN** Temporal is connected and the requested schedule is missing
- **THEN** the route retains 404 SCHEDULE_NOT_FOUND

#### Scenario: Executor gateway compatibility

- **WHEN** starting or listing executions fails while connecting to Temporal
- **THEN** existing 503 TEMPORAL_UNAVAILABLE behavior remains unchanged
