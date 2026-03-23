# Testing Strategy Reference Assets

This directory contains the reusable testing-strategy package for `US-PRG-04-T01`.

## Contents

- `testing-strategy.yaml` — the testing pyramid, cross-domain matrix, taxonomy, console-state expectations, and API-versioning expectations
- `reference-dataset.json` — synthetic fixtures shared across multi-tenant, security, data, event, console, and resilience scenarios

## Usage rules

- Reuse existing fixture IDs whenever possible instead of inventing near-duplicates.
- Add new matrix scenarios before adding framework-specific test implementations.
- Keep the assets synthetic and non-secret.
- Preserve alignment with `apps/control-plane/openapi/control-plane.openapi.json` when contract expectations change.
