# fix-998: Disposable per-run Storage buckets

## Problem

The shared E2E workspace can legitimately have no Storage buckets. Consumers
cannot guess a usable bucket ID, and the provision spec leaks buckets because
its cleanup predates the public bucket-delete route. Leaks consume workspace
quota and eventually block subsequent provisioning.

## Decision and scope

Create a uniquely named bucket per fixture run using the authenticated public
API. Return only `bucket.resourceId` as `bucketId` and a relative `objectPrefix`
in an in-memory handoff. Consumers use that ID with their own tenant/workspace
bearer identity. Allowlist serialization supports an ephemeral runner handoff
without exposing any one-time provision credentials.

Provide finally/afterAll cleanup and a workspace-scoped, explicit stale-fixture
sweep (default TTL 24 hours). Add offline naming/handoff/selection tests, a
LIVE GATE smoke, and repair provision-spec cleanup. Never log or trace token or
provision responses. Provisioning 403/409 errors fail explicitly.

No backend, authorization, quota, naming-derivation, Helm, deployment-repository,
or llmwiki changes. No root S3 credentials, backend mutation, or Storage mocks.

## Risk and validation

R1: test/docs only; rollback is reverting this source change. Run offline
contract tests and load both Playwright specs. Authorized real-stack runs verify
object I/O, denial, concurrent isolation, failure cleanup and repeated teardown.
The sandbox has no live identity/stack; live checks keep the existing skip gate.
Staging bucket.admin grants and sweep scheduling remain operator responsibilities.
