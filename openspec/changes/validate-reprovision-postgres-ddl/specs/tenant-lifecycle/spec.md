## ADDED Requirements

### Requirement: Column data types and defaults are validated against allowlists before DDL construction

The system SHALL validate every `data_type` value against a PostgreSQL type allowlist (base scalar types, constrained length/precision forms, array suffixes) before interpolating it into a DDL statement. The system SHALL validate every `column_default` value against a safe-default ruleset (numeric literals, single-quoted string literals, `true`, `false`, `null`, and approved function calls such as `now()` and `gen_random_uuid()`) before interpolation. The system SHALL reject the entire reprovision operation with a validation error and SHALL NOT execute any DDL if any column field fails validation.

#### Scenario: Non-allowlist data_type is rejected before DDL execution

- **WHEN** a reprovision config contains a column with `data_type` set to a value outside the PostgreSQL type allowlist (e.g. `text); DROP TABLE x; --`)
- **THEN** the system returns a validation error
- **AND** no DDL statement is sent to the database

#### Scenario: Injection payload in column_default is rejected

- **WHEN** a reprovision config contains a column with `column_default` set to a value outside the safe-default ruleset (e.g. a semicolon-separated statement)
- **THEN** the system returns a validation error
- **AND** no DDL statement is sent to the database

#### Scenario: Standard type with safe default provisions successfully

- **WHEN** a reprovision config contains columns using recognized PostgreSQL types (e.g. `text`, `integer`, `timestamp with time zone`) and approved defaults (e.g. `now()`, `gen_random_uuid()`, `0`)
- **THEN** the system provisions the table successfully

### Requirement: Privilege type is validated against the fixed SQL privilege keyword set

The system SHALL validate every `privilege_type` value in GRANT definitions against the fixed set of SQL privilege keywords: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`. The system SHALL reject the reprovision operation with a validation error and SHALL NOT execute any GRANT statement if an unrecognized privilege keyword is supplied.

#### Scenario: Non-standard privilege_type is rejected

- **WHEN** a reprovision config contains a GRANT definition with `privilege_type` set to a value outside the recognized privilege keyword set (e.g. `SELECT; DROP TABLE x; --`)
- **THEN** the system returns a validation error
- **AND** no GRANT statement is sent to the database

#### Scenario: Recognized privilege provisions successfully

- **WHEN** a reprovision config contains a GRANT definition with a recognized `privilege_type` such as `SELECT`
- **THEN** the system issues the GRANT statement successfully

### Requirement: View definitions are sourced from trusted configuration only

The system SHALL NOT interpolate tenant-supplied `item.definition` strings as the SQL body of `CREATE OR REPLACE VIEW` statements. The system SHALL reject any reprovision config that attempts to supply a view definition from tenant-controllable input, returning a validation error before any DDL is constructed.

#### Scenario: Tenant-supplied view definition is rejected

- **WHEN** a reprovision config supplies an `item.definition` field containing arbitrary SQL as a view body
- **THEN** the system returns a validation error
- **AND** no `CREATE OR REPLACE VIEW` statement is sent to the database
