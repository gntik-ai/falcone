## ADDED Requirements

### Requirement: Mongo bearer traffic is gateway authenticated and workspace bound

Bearer `/v1/mongo/*` traffic SHALL use route 2006 to reach the control plane executor. The gateway SHALL authenticate the token with signing keys from a configured Keycloak JWKS base, where the issuer is the configured issuer base followed by `/realms/` and a strictly validated realm name. The verifier SHALL never fetch an issuer outside that base, SHALL use a bounded cache, and SHALL reject malformed, expired, unsigned, invalid-signature, unknown-key, and foreign-issuer tokens with 401 before reaching an upstream. Failed JWKS fetches SHALL not evict successfully cached keys, and each gateway worker SHALL bound its JWKS fetch rate or concurrent fetches. Platform-realm tokens SHALL meet the existing configured audience rule. With `gateway.mongoBearer.enforceTenantAudience` true, tenant-realm tokens SHALL contain `gateway.mongoBearer.tenantAudience` (default `falcone-data-api`) in `aud`, as an exact string or array member. Gateway and executor SHALL reject missing/wrong `aud` with 401, including when `azp` equals the required audience. Enforcement with an empty or absent configured tenant audience SHALL fail closed by configuration/schema rejection or 401. Newly created tenant realms SHALL require no route configuration change.

The gateway SHALL remove client identity headers and inject `x-gateway-auth` from the Secret-backed environment interpolation. The executor SHALL reject a token bound to workspace A when its request addresses workspace B. The API-key route 2006-key SHALL retain its existing scope and rate-limit behavior.

#### Scenario: Tenant bearer document request

Given a valid tenant-realm bearer token containing the tenant data-API audience and a matching workspace path, when a client creates, lists, gets, updates, replaces, or deletes a Mongo document, then route 2006 reaches the executor handler.

#### Scenario: Audience rejection at both trust boundaries

Given enforcement is true and a valid signed tenant-realm token lacking the required audience in `aud`, including an `azp`-only token, when a client calls the Mongo API through route 2006 or directly at the executor, then it receives 401, never `NO_ROUTE`. An empty/absent configured audience SHALL never accept any token while enforcement is true. With enforcement false, the previous tenant audience behavior remains. Platform audience behavior remains unchanged in both states.

#### Scenario: Untrusted bearer request

Given a missing, malformed, expired, foreign-issuer, or unverifiable token, when a client calls the Mongo API, then the gateway returns 401 and forwards no request.

#### Scenario: Unknown realms cannot flush trusted keys

Given successfully cached keys for a valid realm, when requests present tokens naming many unknown realms, then failed JWKS fetches do not evict the valid realm's keys and the worker bounds the resulting fetch load.

#### Scenario: Workspace mismatch

Given a valid token bound to workspace A, when a client addresses workspace B, then the executor returns 403.

### Requirement: Mongo gateway policy uses the realm JWKS verifier

The `public-api-mongo` product route SHALL require `issuer-jwks-auth` instead of `openid-connect`. Other product routes SHALL retain `openid-connect`. Existing `limit-count`, `client-control`, `request-validation`, `cors`, and `proxy-rewrite` requirements SHALL remain in force.

#### Scenario: Gateway policy validation

When the gateway policy contract validates route inventory, then it accepts the Mongo verifier only on `public-api-mongo` and rejects a Mongo route that restores `openid-connect` without the verifier.

### Requirement: Tenant-app and service-account audience provisioning and reconciliation precede enforcement

Both the control-plane saga and WF-CON-002 SHALL ensure exactly one named `oidc-audience-mapper` emitting the configured tenant audience into access tokens on the tenant-app client. They SHALL list existing mappers before POST and SHALL skip POST when that name exists; conflicting or duplicate named mappers SHALL fail visibly. Re-running SHALL create no duplicate. The control-plane's own JWT verifier SHALL retain its current behavior.

The control-plane service-account creation handler SHALL call the same idempotent audience helper after creating the confidential client and before inserting the service-account record. Mapper failure SHALL fail account creation without inserting a successful account record or exposing raw provider errors. A mapper retry SHALL create no duplicate.

WF-CON-002 SHALL also ensure the tenant-app client's hardcoded `tenant_id` mapper matches the realm, preserving the saga's claim contract and creating no duplicate on retry. Until the chart wires the control-plane provisioner and kind routes to the configured audience, source deployment validation SHALL reject any `tenantAudience` other than `falcone-data-api`. Rollout preflight SHALL validate the merged values layers, including customer/local overrides.

#### Scenario: Existing tenant reconciliation

The reconciliation SHALL use the existing Keycloak admin environment, remain read-only by default, and list realms and managed tenant-app/service-account clients missing the mapper, selected by `in-falcone.kind`. Disabled service accounts SHALL also be reconciled, and unrelated clients SHALL remain untouched. A missing tenant-app client or a conflicting/duplicate mapper on either client kind SHALL still fail realm inspection before repair. `--apply` SHALL add missing mappers; a second `--apply` SHALL report zero repairs. Credentials and raw provider error bodies SHALL never appear in reports.

#### Scenario: Staging rollout order and configuration parity

Default and kind values SHALL enforce tenant audiences. Staging SHALL keep enforcement false until the operator records successful reconciliation of both tenant-app and service-account clients, then enable enforcement in a values revision. Prod SHALL reconcile both client kinds before rolling out inherited enforcement and SHALL use operator-supplied hosts. Route 2006 and the executor ConfigMap SHALL render the same tenant audience for every profile. The executor flag SHALL be `KEYCLOAK_ENFORCE_TENANT_AUDIENCE`; the audience SHALL be `KEYCLOAK_TENANT_AUDIENCE`. The shared executor verifier applies this rule to all its tenant-token routes; other required callers need audience preparation before enforcement.
