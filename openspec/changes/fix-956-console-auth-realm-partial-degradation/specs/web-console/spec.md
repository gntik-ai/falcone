# web-console — spec delta for fix-956-console-auth-realm-partial-degradation

## ADDED Requirements

### Requirement: Realm inventory degrades by section

The Auth/IAM console SHALL load the users, roles, scopes, and clients realm inventory sections
independently. A failed section SHALL display an inline error attributed to that section in Spanish,
using the localized console error description and never a raw exception message. Successful sections
SHALL keep their counts and data while another section has failed, and a failed section SHALL not
show a zero count or empty-state copy in place of its error.

Retryable failures without a status, with status 429, or with a 5xx status SHALL offer
`Reintentar`; that action SHALL request only the failed section. Failures with status 401, 403, or
404 SHALL not offer retry. Changing the tenant or realm SHALL discard in-flight results and reset
every section. The compatibility badge SHALL use the first available fulfilled response carrying
compatibility data and remain hidden only when no fulfilled response has it.

#### Scenario: Scopes endpoint is unavailable while other inventory is available

- **WHEN** users, roles, and clients return successfully and the scopes request returns 404
- **THEN** the Usuarios, Roles, and Clientes counts and the Clientes IAM table remain visible,
  while the Alcances section displays its attributed localized error without `Reintentar`

#### Scenario: Retry a failed clients section

- **WHEN** the clients request fails with a 503 status while the other realm inventory requests
  succeed
- **THEN** the Clientes section offers `Reintentar`, and selecting it requests only the clients
  endpoint while the successful sections remain visible
