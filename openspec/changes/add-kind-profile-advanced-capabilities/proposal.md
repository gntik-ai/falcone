# add-kind-profile-advanced-capabilities

## Change type
enhancement

## Capability
functions / realtime (cap-functions, cap-realtime)

## Priority
P2

## Why
Several expected capabilities are not deployed in the kind profile:
- Realtime (Mongo SSE) — FerretDB being broken + no explicit kind gate.
- Workflows (Temporal) — component disabled, `TEMPORAL_ADDRESS` unset → 501.
- MCP hosting — component disabled, `MCP_ENABLED` unset → routes not registered.
- CDC bridge — no pods in kind profile.
- Webhooks — dead without Temporal.

As a result, these capabilities cannot be exercised or tested in the standard kind
deployment.

## What Changes
1. Add env flags and component enable switches to the kind values profile so that
   realtime (PG-table SSE at minimum), Temporal (lightweight mode), and MCP hosting
   can be enabled with an opt-in overlay (`values-kind-advanced.yaml`).
2. Wire the necessary dependencies (Temporal address, MCP env flags, realtime gate).
3. Document the advanced-profile install recipe.

## Impact
- Enables testing of the full capability surface on kind.
- **Dependencies:** B.1 (FerretDB auth fix) for Mongo SSE; Temporal chart/operator
  for workflows.
