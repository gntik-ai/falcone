# deployment — spec delta for fix-temporal-secret-password-substitution

## ADDED Requirements

### Requirement: Temporal MUST connect using a secret-sourced password without leaking it

The system SHALL allow the Temporal server datastore password to be supplied from a Kubernetes Secret
(`temporal.persistence.existingSecret` + `passwordSecretKey`) such that the server authenticates
successfully AND the password never appears literally in a ConfigMap.

The plain `temporalio/server` image does NOT expand `${...}` env references in its config file, so a
rendered `password: "${POSTGRES_PWD}"` is used verbatim and authentication fails
(`no usable database connection found`). When `existingSecret` is set the chart SHALL therefore render
a literal `"__TEMPORAL_DB_PASSWORD__"` placeholder (for both the default and visibility datastores) in
the config ConfigMap, and the server start wrapper SHALL substitute it from the `POSTGRES_PWD` env
(injected via `secretKeyRef`) into a writable in-pod copy of the config before start. The substituted
value SHALL be escaped so any generated password is injected literally, and the password SHALL exist
only in the in-pod copy, never in the ConfigMap. With no `existingSecret` the inline password is
rendered as before (dev/sandbox default).

#### Scenario: existingSecret with a generated password

- **WHEN** `temporal.persistence.existingSecret` + `passwordSecretKey` are set and the Postgres
  password is a generated (non-default) value
- **THEN** the Temporal frontend/history/matching pods start (no `no usable database connection`) and
  the rendered config ConfigMap does NOT contain the plaintext password

#### Scenario: placeholder rendered, not plaintext, when existingSecret is set

- **WHEN** the config ConfigMap is rendered with `existingSecret` configured
- **THEN** both datastore `password` fields render `"__TEMPORAL_DB_PASSWORD__"` (a placeholder), and
  neither the plaintext password nor an unexpanded `${POSTGRES_PWD}` literal appears in the ConfigMap

#### Scenario: start wrapper substitutes the secret-sourced password

- **WHEN** a Temporal server pod starts with `existingSecret` configured
- **THEN** its start wrapper substitutes `__TEMPORAL_DB_PASSWORD__` from the `POSTGRES_PWD` env (which
  is sourced from the existingSecret via `secretKeyRef`) into the writable in-pod config copy, with
  the value injected literally even when it contains shell/sed-special characters

#### Scenario: default inline password unchanged

- **WHEN** no `existingSecret` is configured
- **THEN** the config renders the inline `persistence.password` and no placeholder is emitted, so the
  dev/sandbox default is unchanged
