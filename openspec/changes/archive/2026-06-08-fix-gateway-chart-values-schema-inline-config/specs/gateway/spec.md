## ADDED Requirements

### Requirement: Helm chart SHALL render without schema-validation errors when inline component config contains nested object or array values

The system SHALL accept `"object"` and `"array"` values — in addition to scalar types `"string"`, `"number"`, and `"boolean"` — as valid entries under any component's `config.inline` map in `charts/in-falcone/values.schema.json`, so that `helm template` and `helm lint` succeed for all default values shipped in `charts/in-falcone/values.yaml`.

The relaxation SHALL be scoped to the `config.inline.additionalProperties` type union only; all other chart schema constraints SHALL remain unchanged.

#### Scenario: Chart renders with nested-object inline config (observability metricsStack)

- **WHEN** `helm template falcone charts/in-falcone` is executed against the default `values.yaml` that sets `observability.config.inline.metricsStack` to a nested object (containing `version`, `model`, `retention`, `requiredLabels`, `tenantIsolation`, and `collectionHealth` sub-keys)
- **THEN** the command exits with code 0 and produces rendered Kubernetes manifests with no JSON-Schema validation error referencing `/observability/config/inline/metricsStack`

#### Scenario: Chart renders with nested-object inline config (webConsole auth)

- **WHEN** `helm template falcone charts/in-falcone` is executed against the default `values.yaml` that sets `webConsole.config.inline.auth` to a nested object (containing `realm`, `clientId`, `loginPath`, `signupPath`, and `passwordRecoveryPath` sub-keys)
- **THEN** the command exits with code 0 and produces rendered Kubernetes manifests with no JSON-Schema validation error referencing `/webConsole/config/inline/auth`

#### Scenario: Existing scalar inline config values remain valid

- **WHEN** `helm template falcone charts/in-falcone` is executed against values that include scalar entries under `config.inline` (e.g. `scrapeModel: platform-wide`, `publicPath: /auth`, `homepageHost: console.dev.in-falcone.example.com`)
- **THEN** the command exits with code 0 and no schema-validation error is produced for those scalar keys, confirming the relaxation is additive and does not break existing scalar inline values

#### Scenario: Chart lint passes with updated schema

- **WHEN** `helm lint charts/in-falcone` is executed after the `config.inline.additionalProperties` type union has been extended
- **THEN** the command exits with code 0 and reports no errors or warnings related to the inline config schema
