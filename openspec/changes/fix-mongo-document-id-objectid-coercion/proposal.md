Tracking issue: gntik-ai/falcone#495

## Why

A document's `_id` is stored as a BSON `ObjectId`, but the by-id handlers query `{_id: "<hex>"}` with a plain string, which never matches. As a result get/update/replace/delete by id all silently no-op; DELETE returns `200 {deleted:0}`, i.e. silent data non-deletion.

Live proof (`tests/live-audit/specs/04-document-mongo.sh`): insert a doc, then `GET …/documents/{insertedId}` returns `{found:false}`. (Evidence: `tests/live-audit/evidence/04-document-mongo.md`.)

## What Changes

- Coerce `_id` to an `ObjectId` (with a string fallback for non-ObjectId ids) in the mongo executor's by-id handlers so the query matches the stored document.

## Capabilities

### New Capabilities

### Modified Capabilities

- `data-services`: Document by-id get/update/replace/delete operate on the stored `ObjectId`, so by-id round-trips and deletes work.

## Impact

- Mongo executor by-id handlers (get/update/replace/delete).
