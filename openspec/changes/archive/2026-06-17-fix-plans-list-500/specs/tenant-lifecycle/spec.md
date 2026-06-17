# tenant-lifecycle — spec delta for fix-plans-list-500

## ADDED Requirements

### Requirement: Plan catalog listing returns 200 for superadmin

The control-plane runtime SHALL provision the plan catalog schema (the `plans` relation
and its companion plan tables) so that `GET /v1/plans` responds with **HTTP 200** and a
paginated catalog envelope when called by an authenticated superadmin, and MUST NOT
return a 500 `relation "plans" does not exist` error.

#### Scenario: Superadmin retrieves plan catalog

- **WHEN** a superadmin calls `GET /v1/plans`
- **THEN** the response MUST be **200** with a JSON body containing the `plans` array
  (possibly empty on a fresh platform) plus `total`, `page`, and `pageSize`, and MUST
  NOT be a 500 error

#### Scenario: Non-superadmin is forbidden

- **WHEN** a caller that is not a superadmin calls `GET /v1/plans`
- **THEN** the response MUST be **403**
