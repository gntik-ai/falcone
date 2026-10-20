## Why

Issue #938 (GAP-FAL-002 / GAP-AI-002) reports that provider credentials resolve only from
operator-provisioned environment variables even though the write-only workspace secret store
already supports OpenBao reads. Workspace administrators need request-time provider key rotation.

## What Changes

- Add the exclusive `{ workspaceSecret: "<name>" }` reference form for LLM and embedding providers.
- Resolve through the existing workspace store `getValue` using the connection or batch row's
  verified tenant/workspace, on every request. Preserve the reserved-prefix env resolver and SSRF gate.
- Validate names and check workspace-local existence before all provider configuration writes.
- Share one `vaultStoreFromEnv` instance between the executor's provider planes. Ship its module in
  both images because the worker imports the shared guard, but never inject a store into the worker.
- Publish the shared reference schema and document the existing legacy provider configuration PUT
  endpoints so the workspaces family and generated bundle retain the schema during regeneration.
- Sanitize embedding transport/parser errors so provider response text cannot disclose credentials.

## Non-Goals

No new secret write API, credential caching, database migration, UI work, worker OpenBao binding,
chart modification, deployment, merge, or change to the env allow-list or endpoint SSRF policy.

## Risk and Rollback

R3: independent review by both providers and human approval remain release gates. Each workspace
credential request adds an OpenBao read. An unavailable store fails closed before provider I/O.
Reverting the image restores env-only resolution; existing workspace references then fail closed.
The chart source already binds the executor to workspace-secrets-role, grants workspace KV read in
functions-policy.hcl.yaml, and supplies BAO_ADDR through runtime config. Live evidence belongs to
verification, including create/rotate/complete without a pod restart.
