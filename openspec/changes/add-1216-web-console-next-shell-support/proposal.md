# Add u1 shell prerequisites to the next console

## Why

Issue #1216 needs shared shell and test support before individual u1 page
migrations. The immutable source base is 53375b42. Guards have fixed denial copy,
all navigation hands off to legacy, protected intent omits the router basename,
and context failures lose their HTTP status. Page tests lack a session-only
provider and the parity backend only registers shell endpoints.

## What changes

- Optional translated denial title and description, with unchanged defaults.
- Optional migrated route metadata and router links for flagged targets only.
- Store the complete router href as protected intent, including basename.
- A persisted-session Vitest helper without ProtectedRoute's auth lifecycle.
- Per-test parity endpoint registration, opt-in workspace roles and response
  delay/failure/retry scenarios, preserving strict local-request boundaries.
- Retain numeric context error status alongside the existing boolean error;
  reuse forbidden body copy for 403 and network body copy for every other error.

## Boundaries and rollback

R3 as classified by the control plane. Human approval and both-provider review
remain delivery gates outside this maker. Changes are confined to
apps/web-console-next and this OpenSpec directory. No production route is marked
migrated. No legacy console, shared API package, UI kit, chart, deployment or
release changes. AccountMenu has no route links. Restoring intent after sign-in
is deferred to the u1 login migration. Revert the eventual merge to roll back;
no data migration is involved. No falcone v* release before /next staging
verification of navigation, intent storage and the 403 notice.
