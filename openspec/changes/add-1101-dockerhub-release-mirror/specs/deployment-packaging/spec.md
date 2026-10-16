# Deployment packaging delta

## ADDED Requirements

### Requirement: Isolated digest-preserving Docker Hub publication

The release workflow SHALL mirror its six GHCR images to `docker.io/gntik` only by
`docker buildx imagetools create --prefer-index=false` from a GHCR digest reference. It SHALL
resolve matching valid version and short-SHA digests in the Hub job, never from matrix outputs.
All existing GHCR build steps, triggers, workflow permissions and build inputs SHALL remain
unchanged. Workflow concurrency SHALL be absent. GHCR and Hub SHALL use distinct per-image
concurrency groups with `cancel-in-progress: false` and `queue: max`.

#### Scenario: Credential gate

- **WHEN** either Docker Hub secret is empty
- **THEN** preflight SHALL fail with an error naming exactly the empty variables, without values
- **AND** preflight's unconditional login SHALL also gate builds on invalid credentials
- **AND** preflight SHALL have no GitHub permissions and no checkout

#### Scenario: Hub job isolation

- **WHEN** all GHCR build legs succeed, including verified skip paths
- **THEN** the read-only Hub job SHALL run the same matrix with fail-fast disabled and a 30-minute timeout
- **AND** all six steps SHALL honor the existing manual function-runtime publish condition
- **AND** repository work and copying SHALL never run in the GHCR job

#### Scenario: Missing immutable tags

- **WHEN** the unauthenticated repository lookup is public or 404 and tag inspection permits copying
- **THEN** both tags SHALL be inspected before any write
- **AND** one dry-run's manifest SHA-256, excluding one trailing output newline, SHALL match GHCR
- **AND** one create SHALL target only missing refs, followed by verification of both tags
- **AND** repository visibility SHALL be checked even on no-copy paths, with five retries for 404

#### Scenario: Conflicts and registry errors

- **WHEN** an immutable Hub tag differs, a hidden repository has an existing tag, a dry-run differs,
  or a lookup/inspect fails with an unexpected error
- **THEN** the job SHALL fail before writing
- **AND** only absent/private repositories SHALL treat denied, unauthorized or insufficient_scope
  inspections as missing; not-found detection SHALL reuse the existing workflow regex
- **AND** push denial, post-copy mismatch or non-public post-push visibility SHALL fail loudly
- **AND** API lookups SHALL never receive credentials or mutate repository state

#### Scenario: Latest reconciliation and races

- **WHEN** GHCR latest matches the release digest
- **THEN** a missing or differing Hub latest SHALL be dry-run checked, copied and verified
- **AND** a matching Hub latest SHALL require zero creates
- **AND** GHCR latest SHALL be re-read after a write; a change or error SHALL fail naming that ref
- **WHEN** GHCR latest is missing or differs
- **THEN** Hub latest SHALL be skipped regardless of the run's push_latest input

### Requirement: Testable release recovery and operator guidance

Quality CI SHALL unconditionally run `node --test tests/blackbox/release-images-workflow.test.mjs`
after unit tests. Tests SHALL extract real scripts and use recording Docker/curl boundary stubs,
real jq, no live registry calls, and static preservation/gate checks. Secrets SHALL only enter
action inputs or env; run scripts SHALL receive refs and digests via env without expression
interpolation. Each Docker Hub secret SHALL occur exactly four times. No error bypass is allowed.
Summaries SHALL record GHCR source/digest, repository state, Hub refs and copy/unchanged/skip actions.

#### Scenario: Cancelled queued run

- **WHEN** release-images completes as cancelled, including a 100-pending queue overflow
- **THEN** a workflow_run watcher with no permissions SHALL fail with the run ID, URL and rerun command
- **AND** documentation SHALL explain both registry pulls, push/create token rights, Public default
  visibility, post-push checks, digest inspection and idempotent re-run recovery
