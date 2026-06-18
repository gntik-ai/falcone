# add-event-trigger-integration

## Change type
enhancement

## Capability
workflows

## Priority
P1

## Why
event->function trigger not deployed (404); event->flow trigger registers (`evt.{ws}.{type}` bound) but a matching published event starts no execution.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: published a matching event (202) → no flow execution started; the manual start path was also blocked by E1 + the dev-Temporal search-attribute gap (the chart's temporal-bootstrap registers the 5 custom SAs).

GitHub issue #564 (epic #543). Evidence: `audit/live-campaign/evidence/23-events-functions.md`.

## What Changes
Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow; ensure the Temporal custom search attributes are registered by the deploy.

## Impact
Publishing an event triggers the bound flow/function and the effect is observable.

Dependencies: Depends on E1.
