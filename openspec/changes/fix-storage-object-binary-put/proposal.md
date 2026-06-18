# fix-storage-object-binary-put

## Change type
bugfix

## Capability
storage

## Priority
P2

## Why
`PUT .../objects/{key}` rejects raw/binary bodies (`400 INVALID_JSON`); only `{content,contentType}` JSON is accepted → faithful binary storage impossible via REST.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** PUT a binary body → 400 INVALID_JSON; only JSON `{content}` works.

GitHub issue #554 (epic #540). Evidence: `audit/live-campaign/evidence/22-storage-s3.md`.

## What Changes
Accept raw bytes (or base64) so arbitrary objects can be stored — kind `storage-handlers.mjs` + product storage handler.

## Impact
Binary round-trip is byte-identical.
