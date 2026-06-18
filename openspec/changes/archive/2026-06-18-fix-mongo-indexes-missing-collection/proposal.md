# fix-mongo-indexes-missing-collection

## Change type
bugfix

## Capability
document-store

## Priority
P2

## Why
`.../collections/{c}/indexes` on a nonexistent collection → 500 (Mongo code 26 leaks); the sibling detail returns a clean 404.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: indexes on a missing collection → 500.

GitHub issue #572 (epic #546). Evidence: `audit/live-campaign/evidence/21-document-mongo.md`.

## What Changes
Return 404 for a missing collection — kind `mongo-handlers.mjs` + product handler.

## Impact
404 not 500.
