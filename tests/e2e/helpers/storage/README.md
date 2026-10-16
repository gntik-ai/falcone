# Disposable Storage fixture contract

Shared E2E buckets are created **per test run through the real public API**. Helm
does not pre-provision an application bucket. Consumers MUST use the returned
`bucket.resourceId`; they MUST NOT construct or guess a physical bucket name.

## Identity and naming

Use `TENANT_A` / `TENANT_B`, `controlPlaneBaseUrl()` (`E2E_CP_BASE_URL`), and
`mintTenantToken` with the existing `E2E_KC_TOKEN_URL` and per-tenant client env
variables. Use only the reviewed workspace identity from those fixtures. Staging
operators must supply their existing authorized fixture configuration; do not put
tenant/workspace IDs, bearer tokens, or credentials in reports or evidence.

Each `setupStorageBucket` call requests `e2e-<purpose>-<runId>`. The purpose is
normalized to lowercase DNS-safe text (at most 15 characters). The run ID is a new
20-character cryptographically random hex suffix, unique to this setup/run. The
entire requested fragment is at most **40 characters**, including the suffix,
because the API truncates that fragment before deriving its physical bucket ID.
Names match `/^[a-z0-9-]{3,63}$/` and keep the `e2e-` sweep prefix.

The identity needs `bucket.admin` in its own workspace and object read/write
permissions. Provisioning must return **201**. HTTP **403** fails explicitly with
`bucket.admin is required`; HTTP **409** fails explicitly with
`STORAGE_QUOTA_EXCEEDED or bucket conflict`. Neither is a successful smoke. A
missing staging grant requires a separate authorized identity/role change.
Concurrent runs have different names but still share the workspace bucket quota
(default eight).

## Setup, handoff, and teardown

The reusable functions live in `storage-bucket-fixture.ts`; naming, allowlist
serialization, and sweep selection live in `storage-fixture-contract.mjs`.

Create a standalone Playwright `playwright.request.newContext()` and set
`test.use({ trace: 'off' })` **at file scope** for specs that provision buckets or
mint tokens. Do not use a traced `request` fixture. Disable HTTP debug logging,
HAR recording, request/response attachments, and verbose external reporters for
these operations. The provision response includes one-time `storageCredential`
material; never log it, attach it, or persist it. The API client releases retained
response bodies after parsing; setup immediately projects a safe handoff.

```ts
const token = await mintTenantToken(ctx, TENANT_A)
// Apply the existing LIVE GATE if auth or the real storage stack is unavailable.
const client = createStorageApiClient(ctx, controlPlaneBaseUrl(), TENANT_A, token)
await withStorageBucket(client, TENANT_A, 'wiki-draft', async handoff => {
  // Pass the handoff to the consumer in memory; never pass the provision response.
  const key = `${handoff.objectPrefix}incomplete-draft`
  await client.putObject(handoff.bucketId, key, Buffer.from('partial draft'))
  // Consumer uses the same tenant/workspace bearer identity for get/list/delete.
}) // finally: remove objects, then bucket, even if the consumer throws
```

The reviewed handoff transport is **in-memory** by default. It contains exactly
`bucketId` (the returned resource ID) and `objectPrefix` (`artifacts/`, a relative
object-key prefix). It has no tenant/workspace IDs, tokens, storage credentials,
access keys, or secret fields. If an external runner needs a file or environment
variable, it must use `serializeFixtureHandoff(handoff)`; this allowlists those
same two fields and drops all extra fields. Keep runtime handoffs ephemeral,
outside evidence and version control. No llmwiki file/env convention is imposed
by this repository change.

For explicit lifecycle control, call `setupStorageBucket` and always call
`teardownStorageBucket(client, handoff)` from `finally` or `afterAll`, before
disposing the context. Register each handoff immediately so another failing
setup cannot hide it. Teardown follows object-list cursors, deletes objects, then
calls `DELETE /v1/storage/buckets/{bucketId}`. Repeated teardown accepts 404 as
already absent. Other errors fail visibly; no tenant/workspace purge is used.

## Stale-fixture sweep

An authorized operator or workspace-scoped test runner may explicitly call
`sweepStorageBuckets(client, TENANT_A)`. This is not a general tenant cleanup job
or a suite-start prerequisite. Its default TTL is **24 hours**; an operator can
supply `{ ttlMs }` based on the longest active consumer run. Do not lower the TTL
below active run duration. Schedule/ownership of the staging sweep remains with
that workspace's authorized E2E operator.

The helper lists via `GET /v1/storage/buckets` and selects only entries whose
tenant AND workspace equal the caller fixture, whose server-supplied
`timestamps.createdAt` is strictly older than the TTL, and whose resource ID
matches `ws-<hash12>-e2e-<purpose>-<20 hex runId>`. Missing/invalid/future dates,
other workspaces, other tenants, non-fixture names and fresh runs are preserved.
It uses the same object/bucket teardown and never derives a deletion target from
a guessed name. The returned IDs are for in-memory bookkeeping, not evidence.
Optional `onlyBucketIds` further restricts selection to reviewed handoffs; it
never overrides workspace, prefix or age checks. The live sweep probe uses this
restriction when advancing its clock, so other runs cannot become candidates.

## Validation

Offline contract tests (no Storage mocks):

```sh
node --test tests/unit/storage-bucket-fixture.test.mjs
```

Authorized real-stack run using the existing env configuration:

```sh
tests/e2e/node_modules/.bin/playwright test \
  --config=tests/e2e/playwright.config.ts --project=other --reporter=line \
  tests/e2e/specs/storage/storage-bucket-fixture.spec.ts \
  tests/e2e/specs/storage/storage-provision-bucket.spec.ts
```

The LIVE GATE skips explicitly without bearer grants or a reachable storage API.
Once setup is reached, provisioning errors fail. Live probes cover byte-exact
PUT/GET, list and DELETE, TENANT_B GET/PUT/list returning 404 with the same error
as a nonexistent bucket, no-token 401, guessed-name 404, concurrent isolation,
finally cleanup after a deliberate failure, repeated teardown, bucket absence
and a restricted clock probe that deletes an expired fixture while preserving a
recent fixture and an old non-prefixed control bucket. Offline selection tests
also cover foreign workspace/tenant candidates. Repeated provision runs must
be checked by an authorized operator; never mutate a backend to prepare a check.
