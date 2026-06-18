# add-event-driven-triggers

## Change type
enhancement

## Capability
events

## Priority
P2

## Why
Kafka->function trigger is not deployed (404); event->flow is blocked by the missing trigger schema (see C3).

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: event->function trigger 404 on GW+EXEC; event->flow trigger registration 502 (missing tables).

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/13-storage-events-functions.md`.

## What Changes
Deploy/wire the event-trigger consumer so a published event invokes the bound function/flow.

## Impact
Publishing an event invokes a function and/or starts a workflow end-to-end.

Dependencies: Depends on C3.
