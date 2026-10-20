## ADDED Requirements

### Requirement: Self-service provider credentials via workspace secrets

The system SHALL accept a provider secretRef containing exactly one of `name` (the existing
operator env path) or `workspaceSecret` (the workspace secret name). Legacy name-less references
remain subject to their existing fail-closed resolver behavior. Workspace names SHALL pass the
workspace store's validName rule: lowercase, letter first, at most 63 characters, using letters,
digits, hyphens and underscores. References SHALL NOT select another tenant or workspace.

#### Scenario: Completion and live rotation

- **GIVEN** tenant T / workspace W has write-only secret openai-key and a connection referencing it
- **WHEN** a completion runs
- **THEN** the executor reads the value through the existing workspace store getValue under T/W
  and sends it as the provider credential without caching it
- **WHEN** the existing PUT secret API replaces the value
- **THEN** the next completion uses the new value without a restart or redeploy

#### Scenario: Embedding and batch snapshots

- **WHEN** an embedding request or LLM batch request/reconciliation uses a workspace reference
- **THEN** it resolves on each request under the verified connection or saved batch row scope
- **AND** connection changes cannot redirect the batch snapshot credential reference
- **AND** batch rows contain only the reference, never the resolved value

#### Scenario: Fail closed and isolate tenants

- **WHEN** the secret exists only in another tenant/workspace, is missing, the store is disabled,
  or OpenBao returns an error
- **THEN** no outbound provider call occurs
- **AND** completions return 500 LLM_PROVIDER_SECRET_UNRESOLVED; embeddings return 500
  EMBEDDING_SECRET_UNRESOLVED
- **AND** any store diagnostics contain only bounded operation/status information

#### Scenario: Validate configuration before persistence

- **WHEN** deploy/create/replace receives both reference forms or an invalid workspace name
- **THEN** it returns 400 BYOK_SECRET_REF_NOT_ALLOWED without writing configuration
- **WHEN** the secret is absent from the verified caller workspace
- **THEN** it returns 422 BYOK_WORKSPACE_SECRET_NOT_FOUND without writing configuration
- **WHEN** an OpenBao existence check errors
- **THEN** it returns a sanitized 500 BYOK_WORKSPACE_SECRET_UNRESOLVED without writing configuration

#### Scenario: Write-only values

- **WHEN** provider configuration is deployed, fetched, listed, exported, audited, or used in a batch
- **THEN** no response, audit payload, log, error message/body or persisted provider/batch object
  contains a resolved secret value; only the reference name may appear
- **AND** existing connection APIs continue stripping plaintext keys

#### Scenario: Operator env compatibility

- **WHEN** secretRef contains an allow-listed env name such as BYOK_X
- **THEN** the existing confined env lookup behavior is unchanged
- **WHEN** the name is not allow-listed
- **THEN** the credential env variable is never read and resolution fails closed
- **AND** the existing #659 confinement and SSRF regression tests continue to pass unchanged

#### Scenario: Workflow worker

- **WHEN** a workflow worker receives a workspaceSecret reference, including a dual-form row
- **THEN** it fails with LLM_PROVIDER_SECRET_UNRESOLVED without a credential env lookup or outbound call
- **AND** no workspace secret store or OpenBao binding is introduced into the worker
