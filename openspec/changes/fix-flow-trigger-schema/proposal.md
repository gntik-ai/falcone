# fix-flow-trigger-schema

## Change type
bugfix

## Capability
workflows

## Priority
P1

## Why
Publishing a flow with a platform-event or webhook trigger -> 502 TRIGGER_REGISTRATION_FAILED; executor log: `relation "flow_trigger_registrations" does not exist` (also `flow_trigger_secrets`). The governance schema bootstrap omits these tables.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: flow publish with `kind:webhook`/platform-event trigger -> 502; executor logs the missing relation.

GitHub epic C. Evidence: `audit/live-campaign/evidence-rerun/13-storage-events-functions.md`.

## What Changes
Add the trigger tables to the governance migration set.

## Impact
Event/webhook trigger registration succeeds; an event->flow path runs end-to-end.
