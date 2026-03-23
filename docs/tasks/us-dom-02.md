# US-DOM-02 Task Breakdown

## Story summary

Extend the canonical product domain with auditable memberships, invitations, commercial plans, quota policies, deployment profiles, provider capabilities, and effective capability-resolution contracts so later identity, billing, governance, and provisioning work can reuse one tenant-safe vocabulary.

## Backlog-to-artifact traceability

- **T01 — domain models for memberships, invitations, plans, quotas, deployment profiles, and provider capabilities**
  - `services/internal-contracts/src/domain-model.json`
  - `apps/control-plane/src/domain-model.mjs`
  - `apps/control-plane/openapi/control-plane.openapi.json`
- **T02 — business states and lifecycle rules for invitation, membership, plan, and quota governance**
  - `services/internal-contracts/src/domain-model.json`
  - `scripts/lib/domain-model.mjs`
  - `tests/unit/domain-model.test.mjs`
- **T03 — mapping between commercial plans, deployment profiles, and provider-enabled capabilities**
  - `services/internal-contracts/src/domain-model.json`
  - `services/internal-contracts/src/index.mjs`
  - `docs/adr/0007-membership-plan-governance.md`
- **T04 — serialized contracts for effective capability resolution per tenant and workspace**
  - `services/internal-contracts/src/domain-model.json`
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - `tests/contracts/domain-model.contract.test.mjs`
  - `tests/contracts/control-plane.openapi.test.mjs`
- **T05 — seed catalogs and reference fixtures for memberships, invitations, plans, and capabilities**
  - `tests/reference/domain-seed-fixtures.json`
  - `services/internal-contracts/src/domain-model.json`
  - `docs/reference/architecture/domain-governance-model.md`
- **T06 — plan-change scenarios proving safe quota and capability transitions**
  - `services/internal-contracts/src/domain-model.json`
  - `services/internal-contracts/src/index.mjs`
  - `tests/unit/domain-model.test.mjs`

## Executable plan

1. Extend the machine-readable domain contract with new governance entities, state machines, catalogs, and effective-resolution descriptors.
2. Expose the new contracts through control-plane helpers and a public OpenAPI surface aligned with existing versioning and authorization rules.
3. Add pure helper logic and automated tests for capability resolution and safe plan-change evaluation.
4. Extend reference fixtures so seed profiles now cover memberships, invitations, and commercial-governance examples.
5. Record the architectural decision and human-readable guidance for downstream identity, billing, provisioning, and observability tasks.
