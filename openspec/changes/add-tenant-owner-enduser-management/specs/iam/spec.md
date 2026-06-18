# iam — spec delta for add-tenant-owner-enduser-management

## ADDED Requirements

### Requirement: Tenant-owner app-end-user management API

The system SHALL ensure that tenant-owner app-end-user management API: A project-scoped end-user management API authorized for the owning tenant.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An owner lists/disables/deletes only its own project's end-users
