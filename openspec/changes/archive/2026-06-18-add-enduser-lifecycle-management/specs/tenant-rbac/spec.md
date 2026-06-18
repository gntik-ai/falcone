# tenant-rbac — spec delta for add-enduser-lifecycle-management

## ADDED Requirements

### Requirement: No API to disable/delete app end-users

The system SHALL ensure that no API to disable/delete app end-users is corrected: Implement the disable/delete (and status) end-user routes scoped to the owner's realm.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Owner disables then deletes an app end-user
