# Fix storage.get's canonical route and response decoding

## Why

Issue #1002 reports that the Flow activity requests an obsolete `/download` suffix. The control plane registers the full-object GET with `storageGetObject` on the object path itself, so an existing object is reported as missing. That handler returns a JSON envelope; treating its serialized body as object bytes also corrupts the result and reports `application/json` as the object's content type.

## What changes

- Request the canonical object GET, encoding bucket ID and object key independently. Keep one request, no Range header, and the existing execution-scoped Bearer credential.
- Parse the JSON envelope, pass through its string `contentBase64`, and use its string `contentType`, defaulting to `application/octet-stream`. Malformed success envelopes fail with a generic, non-retryable `UPSTREAM_ERROR` without echoing payloads.
- Preserve the public output schema, serialized output cap, and existing HTTP error classifications. All 404 responses, including cross-tenant `BUCKET_NOT_FOUND`, remain non-retryable `OBJECT_NOT_FOUND`.
- Cover URL encoding, binary envelopes, malformed responses, status mapping, output bounds, real route-table matching, public schema validation, and a handler-to-activity binary round trip and tenant denial.

## Scope and risk

R2: this is a read-only workflow-worker correction with no persisted state or migration. Control-plane routes and handlers, storage.put, dependency manifests, deployment files, and Hermes-managed chart pins remain unchanged. Existing ownership enforcement is per tenant; sibling workspace isolation is separate work. Rollback restores the previous workflow-worker image digest and its known-broken storage.get behavior.

Live Flow execution and a two-tenant probe remain an integration handoff after #997 is resolved. Local handler tests establish source behavior, not staging evidence.
