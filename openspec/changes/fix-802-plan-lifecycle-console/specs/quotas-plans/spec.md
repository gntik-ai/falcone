# quotas-plans - spec delta for fix-802-plan-lifecycle-console

## ADDED Requirements

### Requirement: Safe plan removal API

The system SHALL expose a superadmin-only plan removal action that hard-deletes only
plans with no tenant assignment history and refuses removal of plans that are active,
assigned, or historically assigned, so audit and entitlement history remain intact.

#### Scenario: Delete a never-assigned plan

- **WHEN** a superadmin deletes a plan that has never been assigned to a tenant
- **THEN** the plan is removed, the deletion is audited, and a plan deletion event is
  emitted

#### Scenario: Refuse deletion for assignment history

- **WHEN** a superadmin deletes a plan that has active or historical tenant assignments
- **THEN** the API rejects the request with a conflict error and the plan remains available
  for lifecycle retirement through archive

#### Scenario: Non-superadmin deletion attempt

- **WHEN** a non-superadmin attempts to delete a plan
- **THEN** the API rejects the request with `FORBIDDEN`
