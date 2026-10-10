## ADDED Requirements

### Requirement: Publish accepts only caller-supplied usable payloads

Both the topic-scoped and workspace-scoped Events publish routes SHALL select an own payload
field before an own value compatibility field. The selected value SHALL be non-null and defined.
They SHALL reject unusable bodies with 400 VALIDATION_ERROR and a message naming payload after
tenant management authorization and before allocating a producer or entering metadata recovery.

#### Scenario: No readable payload field

- WHEN an authorized caller sends an absent or null body, an empty object, or a body containing
  only messages, records, data, message, or inherited payload/value fields
- THEN the handler returns 400 VALIDATION_ERROR naming payload
- AND no producer is allocated, connected, or sent a record

#### Scenario: Null or undefined selected value

- WHEN an authorized caller sends a null or undefined own payload, or own value without payload
- THEN the handler returns 400 VALIDATION_ERROR and produces nothing
- AND a usable value field does not override an own null or undefined payload

#### Scenario: Caller-supplied bytes remain unchanged

- WHEN an authorized caller supplies a usable payload or compatibility value
- THEN strings are sent unchanged and other JSON values are JSON serialized as before
- AND the handler returns the existing 202 schema with payloadSizeBytes matching the produced bytes
- AND key and header behavior remains unchanged
- AND payload takes precedence over value

#### Scenario: Explicit empty events remain supported

- WHEN the caller explicitly supplies an empty object or the string representation of an empty object
- THEN the handler accepts it and reports payloadSizeBytes 2
- AND no accepted publish contains a value synthesized by the handler
- AND a blank string remains an accepted caller-supplied value

#### Scenario: Authorization precedes validation

- WHEN a caller fails canManageTenant and supplies an empty body
- THEN the handler returns 403 FORBIDDEN rather than 400
- AND no producer is allocated
