# Console audience reconciliation

## ADDED Requirements

### Requirement: Desired mapper convergence

The bootstrap reconciler SHALL consider the console mapper converged only when exactly one mapper named `in-falcone-audience` exists, its `name`, `protocol` and `protocolMapper` match `console-audience-mapper.json`, `consentRequired` is false, and every desired configuration key exists with exactly its desired string value. Extra configuration keys and top-level provider metadata SHALL be ignored. The same rule SHALL apply before a write and on readback. The desired payload and platform audience SHALL remain unchanged.

#### Scenario: Keycloak 26 adds default configuration

- GIVEN Keycloak stores and returns the desired mapper with `introspection.token.claim=true` and `lightweight.claim=false` as additional string configuration values
- WHEN bootstrap reconciles the mapper and validates readback
- THEN reconciliation succeeds and logs `reconciled platform console audience mapper`
- AND the success marker is written
- AND a second run performs zero writes.

#### Scenario: Missing or drifted mapper

- GIVEN the initial list contains no named mapper, or one named mapper with a wrong audience or a missing or wrong desired configuration key
- WHEN bootstrap reconciles the mapper
- THEN absence causes exactly one POST and drift causes exactly one PUT to `/protocol-mappers/models/<id>`
- AND the PUT payload contains only the desired JSON plus the validated id
- AND successful readback is required before writing the marker.

#### Scenario: Already converged mapper with extras

- GIVEN the initial list contains one converged mapper with extra provider configuration and metadata
- WHEN bootstrap reconciles the mapper
- THEN it performs zero writes and validates readback with the same convergence rule
- AND successful readback produces the success log and marker.

### Requirement: Fail-closed provider responses

The pre-write list and readback SHALL each parse as exactly one JSON array. Empty HTTP 200 bodies, strings, objects, numbers, multiple JSON values and invalid JSON SHALL fail with `list-mappers invalid-shape` or `readback invalid-shape` respectively. Every `jq` read of a provider file SHALL suppress parser errors with `2>/dev/null` and route non-zero exit to a fixed diagnostic. No parse error or missing key SHALL count as convergence.

#### Scenario: Malformed list or readback

- GIVEN either provider response has any disallowed shape or invalid JSON
- WHEN the rendered bootstrap processes that response
- THEN reconciliation exits non-zero with the corresponding stage's `invalid-shape` diagnostic
- AND no success marker is written.

### Requirement: Distinct safe failures and mapper ids

Client lookup non-200 responses or results other than exactly one valid client SHALL fail with `lookup-client`. List non-200 responses SHALL fail with `list-mappers status=<code>`. Multiple named mappers in the initial list SHALL fail with `duplicate`. Write transport errors or non-2xx responses SHALL fail with `write status=<code>`. HTTP status diagnostics SHALL contain digits only for the status. Readback SHALL reject zero or multiple named mappers and distinguish those cardinality failures. Missing or wrong desired fields or configuration keys on readback SHALL fail with `readback-mismatch key=<config key name or field>`.

The named mapper id SHALL match `^[A-Za-z0-9_-]+$` in both the pre-write list and readback, including a converged mapper and a mapper appearing only on readback. Invalid ids SHALL fail with `invalid-id` and the corresponding stage name.

#### Scenario: Provider or write failure

- GIVEN a failed client lookup, failed list request, duplicate named mapper, failed write, or missing or duplicate named mapper on readback
- WHEN bootstrap reaches that stage
- THEN it exits non-zero with the distinct fixed diagnostic for that failure
- AND no marker is written.

#### Scenario: Readback loses a desired value

- GIVEN the write succeeds or the initial mapper is converged
- AND readback omits or changes a desired configuration key or required field
- WHEN bootstrap validates readback
- THEN it fails with `readback-mismatch key=<config key name or field>` without printing the value.

#### Scenario: Invalid id without a PUT

- GIVEN an otherwise converged mapper has an invalid id in the initial list, or an invalid id appears only on readback
- WHEN bootstrap validates that response
- THEN it fails with `invalid-id` and the stage name even when no PUT was needed.

### Requirement: Bounded diagnostics and isolated mutation

On every error path, stdout and stderr SHALL contain only lines beginning with the fixed `[bootstrap] console audience` prefix. Diagnostics SHALL contain only fixed stage text, numeric HTTP status codes and desired configuration key or field names, never provider bodies, tokens, Authorization headers or audience values. Stderr SHALL remain under 1024 bytes. Failure SHALL remove the work directory and leave the marker unwritten. The work directory SHALL use `/tmp/console-audience.XXXXXXXXXX`.

Only the single named mapper SHALL be POSTed or PUT. Other mappers SHALL NOT be modified or deleted. Curl invocation style and token handling SHALL remain unchanged: the token stays in the header only and is unset after reconciliation.

#### Scenario: Hostile provider content

- GIVEN a provider error response containing `private-provider-response-must-not-escape`, the fixture token `offline-fixture`, or an audience value
- WHEN any reconciliation error occurs
- THEN none of those values appears on stdout or stderr
- AND every output line has the fixed prefix, stderr is under 1024 bytes, the work directory is removed and no marker is written.

### Requirement: Rendered-bootstrap regression evidence

Regression tests SHALL run the rendered bootstrap against fake Keycloak responses. Both fakes SHALL support already-converged mappers without forced drift. The Keycloak 26 fake SHALL add default configuration keys on store/readback. The rendered function fixture SHALL remain byte-identical to the chart render. Existing chart, JWT policy snapshot, Keycloak 26 login-import and bootstrap checks SHALL pass, with intentional `currentBootstrapHash` changes updated explicitly.

#### Scenario: Red at base and green after fix

- GIVEN the `kc26-defaults` fixture and chart base `557d118a`
- WHEN the rendered-bootstrap regression runs before the fix
- THEN it reproduces the reconciliation failure caused by added Keycloak configuration keys
- AND the same regression passes with the fix, including the zero-write second run.
