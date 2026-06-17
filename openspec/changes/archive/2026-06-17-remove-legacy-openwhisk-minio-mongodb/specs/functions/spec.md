## ADDED Requirements

### Requirement: Serverless functions run on Knative; the OpenWhisk product is removed

The system SHALL run serverless functions on Knative (the control-plane function executor creates a
Knative Service per function), and SHALL remove the OpenWhisk **product**: the vendored OpenWhisk
deployment (`deploy/kind/openwhisk/`), the OpenWhisk ESO secret templates, the disabled `openwhisk:`
chart stanza, and the `backup-status` OpenWhisk-Action CRD template. The functions API **model**
(the `action`/`package`/`trigger`/`rule` vocabulary in the admin adapter, OpenAPI, route catalog,
and domain model) SHALL be retained as Falcone's own functions model and is not rebranded.

#### Scenario: No OpenWhisk product artifact remains

- **WHEN** the repository is searched case-insensitively for OpenWhisk product artifacts (vendored
  deployment, ESO secrets, chart subchart/stanza, Action CRDs)
- **THEN** none is found, and serverless functions still deploy and invoke via Knative
