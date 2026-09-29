# Proposal: Run workflow and restore E2E tests in CI

## Why

The workflow and restore suites are headless tests but are not exercised by the
pull-request workflow. Plan-enforcement tests currently accept absent service
configuration and report a successful job after skipping every scenario.

## What Changes

- Run the workflow and restore E2E suites in `ci.yml` on pull requests and main
  pushes, preserving their TAP and restore JSON reports as artifacts.
- Gate secret-backed plan-enforcement and plan upgrade/downgrade steps at the
  workflow-step level. When explicitly enabled, plan-enforcement uses strict
  environment validation so incomplete configuration fails rather than skips.
- Add a scheduled and manually dispatchable integration workflow that provisions
  a disposable kind/Helm stack from the pinned charts revision, runs the
  plan-enforcement suite in strict mode, verifies a non-skipped test executed,
  uploads TAP/JSON evidence, and always tears down the stack.
- Pin every GitHub Action used by `ci.yml` and `integration.yml` to a full
  commit SHA with its reviewed release version in a trailing comment.

## Non-Goals

- Modify the Falcone charts repository, repository branch-protection settings,
  product behavior exposed by these tests, or production deployments.
- Run realtime, observability, or hardening tests for every pull request.

## Risks and Rollback

This is an R1 CI-only change. The scheduled integration stack is isolated and
serialized with the existing real-stack shared-host workflow. Its Temporal
no-hooks lifecycle explicitly renders the chart-owned credential and TLS hooks
inside the disposable kind cluster, including a CI-only exception that creates
random ephemeral Kubernetes Secrets rather than sourcing them through
External Secrets/OpenBao. No values file contains credentials, and the normal
local lifecycle is unchanged. Reverting these workflow files restores the
earlier CI schedule without changing runtime code.
