## ADDED Requirements

### Requirement: Execution SSE event stream
The system SHALL expose a Server-Sent Events endpoint `GET /v1/flows/workspaces/{workspaceId}/executions/{executionId}/events` that streams node-status and log-line events for a single workflow execution in near-real-time. The endpoint SHALL follow the existing SSE conventions: `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, `Cache-Control: no-cache`, `retry: 3000` reconnect hint, and a 25-second keep-alive ping comment. The endpoint SHALL accept the tenant API key via the `?apikey=` query parameter so that a browser `EventSource` (which cannot set headers) can authenticate. Header credentials SHALL take precedence over the query parameter.

#### Scenario: Successful stream connection
- **WHEN** an authenticated tenant client opens an `EventSource` to `GET /v1/flows/workspaces/{workspaceId}/executions/{executionId}/events?apikey=<anon-key>`
- **THEN** the server responds with HTTP 200, `Content-Type: text/event-stream`, and `X-Accel-Buffering: no`

#### Scenario: Node-status event emission
- **WHEN** the Temporal execution advances a node (scheduled / started / retrying / completed / failed / skipped)
- **THEN** the server emits an SSE frame `event: node-status` with a JSON data payload containing `nodeId`, `status`, `attemptNumber`, `startedAt`, `completedAt`, and optional `error`

#### Scenario: Log-line event emission
- **WHEN** the flow executor captures a log entry from an activity
- **THEN** the server emits an SSE frame `event: log-line` with a JSON data payload containing `nodeId`, `level`, `message`, and `timestamp`

#### Scenario: Keep-alive ping
- **WHEN** 25 seconds elapse without a data frame
- **THEN** the server emits an SSE comment `: ping` to keep the connection alive through proxy idle timeouts

#### Scenario: Client reconnect with last-event-id
- **WHEN** the client reconnects and supplies the `Last-Event-ID` header
- **THEN** the server resumes the stream from the event following the indicated position and does not re-emit already-delivered events

#### Scenario: Completed execution
- **WHEN** the execution has already reached a terminal state (completed / failed / cancelled / timed-out) before the client connects
- **THEN** the server replays all persisted history events as SSE frames and then emits `event: stream-end` before closing the connection

#### Scenario: Stream closed on client disconnect
- **WHEN** the client closes the connection
- **THEN** the server clears the 25-second ping interval and releases all Temporal SDK subscriptions associated with that stream

### Requirement: Execution SSE tenant isolation
The system SHALL enforce that the `tenantId` resolved from the presented credential matches the `tenantId` of the workspace identified by `{workspaceId}` in the SSE URL. A request whose credential maps to a different tenant SHALL be rejected with HTTP 403 before any Temporal history is accessed.

#### Scenario: Cross-tenant SSE probe rejected
- **WHEN** a client authenticated as tenant A requests the SSE stream for an execution belonging to tenant B's workspace
- **THEN** the server returns HTTP 403 and emits no event frames

#### Scenario: Invalid or missing API key
- **WHEN** a client supplies no credential or an unrecognisable `?apikey=` value
- **THEN** the server returns HTTP 401 before opening the stream

### Requirement: Run-view canvas overlay
The system SHALL render the flow designer canvas in read-only run mode, overlaying each DSL node with a status badge reflecting the latest `node-status` SSE event received for that node. The badge SHALL display the node status (scheduled / started / retrying / completed / failed / skipped), the current attempt number when greater than 1, and the elapsed or total duration. The canvas SHALL be non-interactive (no drag, no edit) while in run mode.

#### Scenario: Live status badge update
- **WHEN** a `node-status` SSE event is received for a node currently visible on the canvas
- **THEN** the node's badge updates within one render cycle to reflect the new status without a full page reload

#### Scenario: Node detail panel
- **WHEN** the user clicks a node in the run-view canvas
- **THEN** a detail panel opens showing the node's activity input payload (capped at 4 KB display), output payload (capped at 4 KB display), final error message and stack excerpt if the node failed, and a chronological list of attempt entries each with status and timestamps

#### Scenario: Completed run rendered from history
- **WHEN** the user opens the run view for an execution that has already reached a terminal state
- **THEN** all nodes are rendered with their final statuses derived from persisted Temporal history without requiring an open SSE connection

### Requirement: Run-history list
The system SHALL provide a paginated list view of workflow executions for a given flow, filterable by `flowId`, `flowVersion`, status, `triggerType`, and a time range (ISO 8601 `startedAfter` / `startedBefore`). The list SHALL be strictly scoped to the authenticated tenant's workspace.

#### Scenario: Filter by status
- **WHEN** the user selects a status filter (e.g. `failed`) in the run-history list
- **THEN** only executions with that status are displayed and the result set is tenant-scoped

#### Scenario: Pagination
- **WHEN** the result set exceeds the page size
- **THEN** the UI renders a next-page control that fetches the subsequent page using the continuation token returned by the list endpoint

#### Scenario: Empty result set
- **WHEN** no executions match the applied filters
- **THEN** the list view shows an empty-state message and no execution rows

#### Scenario: Cross-tenant isolation in list
- **WHEN** the list endpoint is called with a valid credential
- **THEN** it returns only executions belonging to the tenant identified by the credential, regardless of any `tenantId` supplied in query parameters

### Requirement: Cancel execution action
The system SHALL allow a tenant user to cancel a running workflow execution from the run view. The cancel action SHALL be guarded by a confirmation dialog. On confirmation, the system SHALL call the flows control-plane cancel endpoint and optimistically update the execution status in the UI. The action SHALL be recorded in the tenant audit log.

#### Scenario: Cancel confirmation dialog
- **WHEN** the user clicks the Cancel button on an in-progress execution
- **THEN** a confirmation dialog appears before any API call is made

#### Scenario: Successful cancel
- **WHEN** the user confirms cancellation
- **THEN** the system calls the cancel endpoint, the UI reflects the `cancelled` status, and an audit entry is created

#### Scenario: Cancel on already-terminal execution
- **WHEN** the user attempts to cancel an execution that has already completed or failed
- **THEN** the cancel button is disabled and no API call is made

### Requirement: Retry execution action
The system SHALL allow a tenant user to retry a failed or cancelled workflow execution by launching a new run with the same flow version and original trigger input. The retry action SHALL be guarded by a confirmation dialog and SHALL be audited.

#### Scenario: Retry confirmation dialog
- **WHEN** the user clicks Retry on a failed or cancelled execution
- **THEN** a confirmation dialog appears before any API call is made

#### Scenario: Successful retry
- **WHEN** the user confirms the retry
- **THEN** the system submits a new execution with the same `flowId`, `flowVersion`, and trigger input, the UI navigates to the new run view, and an audit entry is created

#### Scenario: Retry unavailable for running executions
- **WHEN** the execution is in a non-terminal state (scheduled / started / retrying)
- **THEN** the retry action is not presented in the UI

### Requirement: Approval signal action
The system SHALL allow a tenant user to send an approval or rejection signal to a human-approval node that is waiting for input. The signal action SHALL be guarded by a confirmation dialog and SHALL be audited.

#### Scenario: Approval signal confirmation dialog
- **WHEN** a node in the run view is in `waiting-approval` status and the user clicks Approve or Reject
- **THEN** a confirmation dialog appears identifying the node and the signal type before any API call is made

#### Scenario: Successful approval signal
- **WHEN** the user confirms the approval signal
- **THEN** the system calls the approval-signal endpoint with the resolved node signal ID, the node's badge updates to reflect the signal sent, and an audit entry is created

#### Scenario: Signal rejected for non-approval nodes
- **WHEN** a node is not in `waiting-approval` status
- **THEN** no approval or rejection controls are rendered for that node

### Requirement: Console component tests for flow monitoring
The system SHALL include Vitest component tests covering the run-view SSE subscription hook, the node-status badge rendering for each status value, the run-history list filters, and the cancel/retry/signal confirmation dialogs. All new tests SHALL pass. Pre-existing Vitest test failures on the main branch SHALL NOT be introduced or widened by this change.

#### Scenario: Node-status badge renders all statuses
- **WHEN** the node-status badge component receives each of the six status values (scheduled / started / retrying / completed / failed / skipped)
- **THEN** the rendered badge displays the correct label and styling for each status

#### Scenario: SSE hook closes subscription on unmount
- **WHEN** the run-view component is unmounted
- **THEN** the `EventSource` subscription is closed and no further state updates are dispatched
