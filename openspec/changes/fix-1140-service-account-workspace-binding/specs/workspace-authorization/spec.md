## ADDED Requirements

### Requirement: Verified binding for newly created workspace service accounts

Creation SHALL derive W exclusively from the authorized resolved workspace r.ws.id.
It SHALL create a disabled confidential client, ensure its tenant audience, ensure
workspace_service_account exists (tolerating 409), and ensure exactly one hardcoded
workspace_id mapper with claim.value W. The mapper SHALL use openid-connect,
oidc-hardcoded-claim-mapper, String JSON type and true access/id/userinfo flags.
An existing exact mapper SHALL cause no POST; any mismatch SHALL fail without POST.

Creation SHALL remove workspace-context from default and optional client scopes,
then inspect the client's own mappers and every attached default and optional
scope. No other workspace_id or workspace_ids source SHALL be allowed. Inspection
SHALL reject oidc-hardcoded-role-mapper, oidc-role-name-mapper and mappers with
claim.name realm_access, resource_access, roles or actor_type.

Creation SHALL assign workspace_service_account to the service-account user and
inspect effective realm roles, including group, composite and default inheritance.
The roles SHALL include workspace_service_account and contain only that role,
offline_access, uma_authorization and default-roles-<realm>. Creation SHALL insert
the registry row for W before the sole final setClientEnabled(true) call.

#### Scenario: Request fields cannot alter the workspace grant

- **WHEN** an authorized caller creates an account for W with body workspaceId other
- **THEN** the mapper and registry bind W, and no workspace_ids claim is emitted
- **AND** the client remains disabled until every check and insert succeeds

#### Scenario: Preparation or registry failure

- **WHEN** any audience, role, mapper, scope, inspection, assignment, effective-role
  or registry step fails
- **THEN** creation attempts client deletion and registry compensation without enabling
- **AND** returns CREATE_SA_FAILED, surfacing and logging redacted cleanup failures

#### Scenario: Final enable committed but its acknowledgement was lost

- **WHEN** enabling throws and the client re-read reports enabled
- **THEN** creation succeeds with its existing registry row and performs no deletion

#### Scenario: Final enable did not commit

- **WHEN** enabling throws and the client re-read reports disabled
- **THEN** creation attempts deletion, removes the row and returns CREATE_SA_FAILED
- **AND** a deletion failure is surfaced while the client remains disabled

#### Scenario: Final enable outcome remains unknown

- **WHEN** enabling and re-reading throw
- **THEN** creation attempts disable and deletion, returning CREATE_SA_FAILED
- **AND** removes the registry row only after a confirmed disable or deletion
- **AND** if all three recovery operations fail, retains the row and reports
  needsOperatorReview plus serviceAccountId in the response and redacted logs

### Requirement: Existing workspace authorization remains bounded

The role catalog and its 13 existing model actions SHALL remain unchanged.
The new verified binding SHALL grant workspace and storage reads only inside W
and its tenant. Structural writes SHALL retain existing administration gates.

#### Scenario: Scoped reads and denied administration

- **WHEN** a token has realm_access.roles workspace_service_account and workspace_id W
- **THEN** GET /v1/workspaces/W succeeds and other workspaces/tenants are forbidden
- **AND** the executor's six structural routes and workspace API-key listing are forbidden
- **AND** W's bucket get, metadata and list succeed, while other workspace buckets
  return 404 BUCKET_NOT_FOUND before S3 and are absent from bucket listing
- **AND** object put/delete return 403 FORBIDDEN before S3
- **AND** other tenants' object reads return 404 and bucket listing is empty before S3

#### Scenario: Existing unbound service accounts

- **WHEN** an existing SA has neither a granting role nor verified workspace binding
- **THEN** its existing storage read denials and empty bucket listing remain unchanged
