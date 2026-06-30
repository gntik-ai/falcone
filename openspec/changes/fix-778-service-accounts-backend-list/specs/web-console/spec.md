# web-console - spec delta for fix-778-service-accounts-backend-list

## MODIFIED Requirements

### Requirement: Service Accounts list comes from the backend, not browser session

The system SHALL load the Service Accounts page from the workspace list endpoint
(`GET /v1/workspaces/{ws}/service-accounts`) rather than per-browser `sessionStorage`, so all
existing service accounts are visible and manageable on any fresh session.

#### Scenario: List is session-independent

- **WHEN** a tenant owner opens the page in any browser/session
- **THEN** all of the workspace's service accounts are listed from the backend
