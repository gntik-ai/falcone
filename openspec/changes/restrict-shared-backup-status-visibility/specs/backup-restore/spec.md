## ADDED Requirements

### Requirement: Shared backup-status rows require a platform-level privilege to be returned

The system SHALL gate the `includeShared=true` branch of `getByTenant` behind a dedicated platform-level scope (e.g. `backup-status:read:shared-platform`). The system SHALL NOT grant cross-tenant shared-instance row visibility to callers whose token only contains the tenant-holdable `backup-status:read:technical` scope.

#### Scenario: Tenant caller with read:technical does not receive other tenants' shared rows

- **WHEN** a caller whose verified tenant is `T1` holds `backup-status:read:technical` but not a platform-level scope
- **THEN** the backup-status response contains only rows scoped to `T1` and MUST NOT include `is_shared_instance=true` rows belonging to other tenants

#### Scenario: Platform caller with platform scope receives shared rows

- **WHEN** a caller holds the platform-level scope `backup-status:read:shared-platform`
- **THEN** the backup-status response may include cross-tenant `is_shared_instance=true` rows as it does today

### Requirement: Shared rows returned to non-platform callers must not expose per-tenant-identifying data

The system SHALL ensure that any `is_shared_instance=true` row surfaced to a non-platform caller has `tenant_id` and other per-tenant-identifying fields (including `detail` and `adapter_metadata`) suppressed or absent from the serialized response.

#### Scenario: Shared rows omit tenant_id and detail for tenant-scoped callers

- **WHEN** a non-platform caller with `backup-status:read:technical` receives a response that includes shared-instance entries
- **THEN** each shared-instance entry in the response MUST NOT contain `tenant_id`, `detail`, or per-tenant content from any other tenant

#### Scenario: Platform caller receives full shared-row data

- **WHEN** a platform-privileged caller requests backup status with shared rows included
- **THEN** each shared-instance entry in the response MAY contain `tenant_id`, `detail`, and `adapter_metadata` fields as currently serialized

### Requirement: The includeShared query path preserves own-tenant data isolation

The system SHALL ensure that the `getByTenant` repository function never returns rows owned by a different tenant as a side-effect of the `includeShared` flag when called by a non-platform caller.

#### Scenario: getByTenant with includeShared false returns only own-tenant rows

- **WHEN** `getByTenant` is invoked with `includeShared=false` for tenant `T1`
- **THEN** the result set contains only rows where `tenant_id = T1` and `is_shared_instance = FALSE`

#### Scenario: getByTenant with includeShared true and no platform gate leaks cross-tenant data

- **WHEN** a non-platform caller triggers `getByTenant` with `includeShared=true` for tenant `T1` after the fix
- **THEN** the system blocks or sanitizes cross-tenant shared rows so that `T1` does not observe another tenant's identifying data
