# web-console — spec delta for harden-workspace-secrets-console-ux

## ADDED Requirements

### Requirement: Workspace Secrets page uses high-consequence console safety patterns

The system SHALL harden the `/console/workspace-secrets` page using shared console primitives:
referenced-secret and production-workspace deletion SHALL use the canonical destructive confirmation
dialog with explicit type-to-confirm; create validation SHALL report name and value errors
per-field in one submit; mutation outcomes SHALL be announced near the affected form, row, or table
region; page navigation and status/table presentation SHALL reuse the console breadcrumb, status
badge, and table conventions.

#### Scenario: Confirmable referenced-secret deletion

- **WHEN** an operator deletes a workspace secret whose metadata reports `resolvedRefCount > 0`
- **THEN** the console opens the shared destructive confirmation dialog, shows the referenced
  function count as cascade impact, requires the operator to type the secret name, and only then
  issues the delete request.

#### Scenario: Confirmable production-secret deletion

- **WHEN** an operator deletes any workspace secret while the active workspace is a production
  workspace
- **THEN** the console requires explicit type-to-confirm even when no function references are
  currently detected.

#### Scenario: Accessible two-field create validation

- **WHEN** the create form is submitted with both the secret name and value invalid
- **THEN** both inputs show their own `aria`-associated error message in the same submit cycle, and
  no create request is issued.

#### Scenario: Workspace Secrets table and feedback stay local to the changed data

- **WHEN** a secret is created, replaced, or deleted
- **THEN** create feedback remains near the create form, replace feedback is shown beside the
  affected table row, delete feedback is shown near the table/list region, and the metadata table
  uses the shared table primitive without a hard `min-w-[64rem]` layout.
