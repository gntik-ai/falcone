# web-console Specification (delta)

## ADDED Requirements

### Requirement: Audit export feedback reflects the real outcome

The system SHALL NOT report audit export success when the audit-export response is only
acknowledged, pending, or otherwise lacks a retrievable artifact. When an audit export is produced,
the system SHALL surface an actionable result, including the export identifier, exported item
counts, masking counts when available, and an artifact retrieval or download surface.

#### Scenario: Completed audit export manifest is produced

- **WHEN** an operator exports audit records and the backend returns a completed audit export
  manifest with `exportId`, `itemCount`, `maskedItemCount`, and `items`
- **THEN** the Audit tab displays the export id, item counts, masking counts, and a
  `Descargar JSON` action for the returned manifest

#### Scenario: Audit export is accepted without an artifact

- **WHEN** an operator exports audit records and the backend returns an acknowledged, pending, or
  otherwise non-completed response without `items` or another retrievable artifact
- **THEN** the Audit tab shows a non-success unavailable/pending state using the backend message
  when present, does not show the generic success message, and does not offer a download action

#### Scenario: Audit export request fails

- **WHEN** an operator exports audit records and the export request fails
- **THEN** the Audit tab surfaces an explicit error and does not show success feedback or a
  download action
