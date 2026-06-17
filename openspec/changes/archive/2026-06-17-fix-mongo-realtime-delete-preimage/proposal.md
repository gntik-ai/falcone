Tracking issue: gntik-ai/falcone#498

## Why

On the Mongo change-stream SSE path, `delete` events never reach subscribers even with `changeStreamPreAndPostImages` enabled: `fullDocumentBeforeChange` isn't populated, so the executor's `$match` delete branch drops the event. (Postgres realtime delivers deletes correctly.) Subscribers therefore keep stale data after a delete. There is no isolation impact — the event is dropped, never leaked cross-tenant.

Live proof (`tests/live-audit/specs/08-realtime.sh`): subscribe to a collection, delete a doc via the driver → no `delete` frame arrives; insert/update frames do. (Evidence: `tests/live-audit/evidence/08-realtime.md`.)

## What Changes

- Drive Mongo `delete` events off the change-stream `documentKey` plus the stored `tenantId` (or a pre-image lookup) instead of relying on `fullDocumentBeforeChange`, so the `$match` branch can deliver them.

## Capabilities

### New Capabilities

### Modified Capabilities

- `realtime`: A tenant's subscribers receive their own Mongo collection `delete` events; cross-tenant deletes remain undelivered.

## Impact

- Mongo change-stream SSE delete branch in the realtime executor (`$match` on delete).
