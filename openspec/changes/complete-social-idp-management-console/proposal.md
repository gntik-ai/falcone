# Proposal: complete tenant social identity-provider management (#950)

## Why

The tenant auth-config console lists and deletes Keycloak social providers but cannot create,
edit or toggle them. Replacing config wholesale can wipe the stored client secret.

## What changes

Add built-in social templates, write-only credential forms, callback setup instructions and
narrow tenant management controls. Validate writes, merge existing Keycloak config and return
only safe metadata. This is the tenant realm surface, separate from application federation.

Supported templates: google, github, microsoft, gitlab, facebook, linkedin-openid-connect.
Existing callers using other providerIds or config keys will receive VALIDATION_ERROR; existing
stored config is retained. Callback URLs derive from KEYCLOAK_ISSUER or remain null.

## Risk and rollback

R1. Credential preservation is covered with fake-Keycloak read/merge/write tests. Masked direct
admin reads fail closed without a replacement, pending deployed-version verification. Reverting
the source image restores the prior console; providers in Keycloak remain and need no migration.
No deployment, realm migration, generic OIDC/SAML, OpenAPI/SDK change or application federation.
