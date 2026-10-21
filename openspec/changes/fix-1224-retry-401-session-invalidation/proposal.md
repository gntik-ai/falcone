# End next-console sessions when the request retry remains unauthorized

## Why

Issue #1224: a protected request can return 401 after the shared API successfully
refreshes and retries it. That rejection currently leaves the session persisted
and the shell displaying a network notice instead of redirecting to login.

## What changes

- Add a shared request hook with no default handler, invoked only for the
  post-refresh retry's numeric 401. Always rethrow the retry error.
- Provide an idempotent local invalidation helper using existing session clear,
  expired hint and event primitives, gated on a persisted session.
- Register once at the next-console entry to cover shell context loaders as well
  as pages, without adding a request or changing refresh/retry logic.
- Test both basenames, concurrent invalidation, unregistered behavior and excluded
  error paths. Update only the authorized existing 401 parity/prerequisite outcomes.

## Boundaries and rollback

R3: human approval and both providers are required before merge. Source only;
legacy console, deployment repository, Helm, credentials and release gates are
unchanged. No page migration, return-path consumption, remote termination or
changes to SSE/raw-fetch paths. Remove the single next-console registration or
revert to roll back. The operator verifies staging before any falcone v* release.
