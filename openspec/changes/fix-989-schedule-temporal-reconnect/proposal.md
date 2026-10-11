# fix-989: Retry failed schedule-plane Temporal connections

## Problem

The schedule plane's boot-time getter retains a rejected connection promise for the
process lifetime. Every subsequent schedule request receives that rejection, even after
Temporal recovers. The schedule gateway also forwards the unclassified SDK error, producing
HTTP 500 CONTROL_PLANE_ERROR rather than the executor gateway's 503 TEMPORAL_UNAVAILABLE.

## Change

Move connection memoization into the schedule gateway. The injected getTemporalClient
factory starts a fresh connection attempt when no promise is cached. Concurrent callers
share the pending attempt; successful connections remain cached. On rejection, clear the
memo, log the original error server-side and throw the sanitized clientError with status
503 and code TEMPORAL_UNAVAILABLE. Keep the dynamic SDK import in main.mjs and the
directly injected temporalClient path.

The public test seams are the registry's scheduleGateway methods, with an injected
connection factory, and the existing HTTP schedule-management routes. No live Temporal
service is needed. Coverage includes repeated failures, recovery without replacing the
registry/server, concurrent requests, connection reuse, redaction and unchanged 501/404
responses.

## Boundaries

This R1 source change does not change charts, dependencies, routing, migrations or the
executor gateway. Connections for execution and scheduling remain separate. Errors during
schedule operations on an already-connected client and the create/update fallback remain
outside this change.

## Rollout and rollback

Use the existing image publication and deployment gates. Already-running executors retain
the old failed promise until replaced; record this alongside the connectivity follow-up
falcone-charts#20 in release notes. Failed requests now spend a fresh SDK connection
deadline before returning 503, consistent with executor routes. Roll back by reverting
the executor image digest. No rollout is performed by this ChangeSet's source maker.
