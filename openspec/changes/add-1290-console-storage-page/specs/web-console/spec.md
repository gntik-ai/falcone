## ADDED Requirements

### Requirement: Workspace storage migration

The next console SHALL dispatch `/console/storage` without role gating while its
migration flag is enabled. It SHALL keep the legacy page intact as rollback.

#### Scenario: Inventory and object inspection

- WHEN an authenticated user selects a tenant and workspace
- THEN GET the first 100 tenant buckets and filter by workspace, and GET workspace usage
- AND expose bucket metadata, timestamp history, generated connection snippets,
  50-object cursor pages, complete object metadata and custom metadata
- AND expose scoped presigned downloads with operation download and TTL 300
- AND display provider unavailability without interpreting it as zero
- AND warn for snapshots older than 15 minutes and explain absent quota limits.

#### Scenario: Explicit mutations and authentication

- WHEN Create, Upload, Export or an exactly typed Delete is activated
- THEN send the legacy method, path and JSON body through the shared session primitive
- AND permit only that primitive's single replay after a successful 401 refresh
- AND retain inputs in local no-access, not-found and retriable failure surfaces
- AND keep retry disabled until settled and announce success.

#### Scenario: Uncertain creation

- WHEN Retry follows a create network failure
- THEN send GET buckets only, never another POST
- AND report created only with no cursor and exactly one new active-workspace
  resource with the exact trimmed requested bucket name
- AND otherwise report an unknown outcome.

#### Scenario: Context isolation

- WHEN tenant or workspace changes during any read or mutation
- THEN abort requests, discard stale completions and prevent their follow-up reads
- AND reset inputs, selection, notices, failures and presigned URLs
- AND close any delete confirmation without sending DELETE and focus the page heading.

#### Scenario: Kit, localization and parity

- THEN use pinned kit components, explicit props, tokens and es/en catalogs
- AND cover loading, empty, no-tenant, workspace-required, 401, 403, 404, 500 and network states
- AND provide keyboard focus, working tabs, bounded table scrolling and no page overflow
- AND test data, actions, errors/empty, accessibility, runtime, responsive, visual and kit checks
  at 375, 768 and 1280 pixels, with presigned output masked in artifacts.
