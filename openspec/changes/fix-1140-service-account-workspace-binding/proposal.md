# Bind new workspace service accounts to verified workspace claims

## Why

Since #973/#1139, a service account without a granting role and verified workspace
binding cannot read storage, including its registry workspace. New account
creation currently provisions an enabled confidential client with only an audience
mapper, so the verified identity has no workspace authority.

## What Changes

Create each new client disabled. After ensuring its tenant audience, ensure the
workspace_service_account realm role and an exact hardcoded singular workspace_id
mapper for the resolved workspace (r.ws.id). Remove workspace-context from default
and optional scopes. Inspect the client's mappers and all remaining attached
scopes for conflicting workspace, role and actor-type claims. Assign the role to
the service-account user and verify its effective realm roles, including inherited
group, composite and default roles. Insert the registry row, then enable last.

Compensate failures by deleting the disabled client and any attempted registry
insert. Surface cleanup failures using redacted messages. Resolve an uncertain
enable by re-reading the client: enabled means successful creation; disabled means
compensation. If the read fails, attempt disable and deletion. Keep the registry
row until one succeeds, retaining a revocation handle for an account whose state
is unknown. Report needsOperatorReview and serviceAccountId in the error and log;
no registry schema change is needed.

## Scope and Compatibility

Only newly created service accounts gain this binding. Never derive workspace
authority from body or query fields. Tokens carry workspace_id, never workspace_ids.
The confidential-client helper still defaults to enabled for other callers.
Custom default or optional scopes that emit conflicting claims intentionally fail
creation closed. Keycloak realm configuration remains administrator controlled;
the inspection is limited to the specified token-shaping sources.

The existing authorization matrix, storage gates, executor authorization, JWT
parsing and deployment charts remain unchanged. Existing service accounts and
unbound users stay denied. Back-fill, user rebinding and token revocation/rollback
procedures belong to the operator-filed #1140 follow-up. A source rollback does
not remove grants from accounts already created by this version.

## Verification Seams

Tests drive LOCAL_HANDLERS.createServiceAccount with fake Keycloak and PostgreSQL
boundaries, then exercise the real Keycloak helpers through fake HTTP responses.
They check ordering, configuration rejection, effective-role allowlisting and
uncertain-write compensation. Signed tokens pass through the control-plane HTTP
harness; the executor uses deriveIdentityFromClaims and its real HTTP parser.
Storage handler tests verify scoped reads and denial before S3. A contract test
pins the existing 13 allowed actions and the singular mapper shape.

A post-merge operator check may obtain a real client_credentials token and verify
workspace_service_account plus workspace_id W, with no workspace_ids. It is not a
source delivery gate. Container builds, scans and independent review remain with
the normal publication pipeline.
