# Design

Resolve the tenant and realm exclusively through authorizeAuthConfig/canManageTenant and the
verified caller/path. Validate alias, built-in providerId, config-key allow-list and scalar types
before Keycloak I/O. Read the existing provider before deciding create requirements; the adapter
rechecks existence before writing. Existing templates cannot change. Preserve metadata and all
stored config while applying only supplied fields. Empty/omitted secrets preserve a readable
stored secret; a masked direct read without a replacement fails closed with no PUT. Literal
masked input is invalid. Verify the deployed Keycloak behavior before release.

Whitelist response fields at both adapter and handler boundaries. Do not retain upstream
social-provider response bodies in diagnostics. Keep the existing route audit descriptor, which
records tenant/path/status/outcome and does not copy request or response config.

Derive the public base from the existing KEYCLOAK_ISSUER URL by removing /realms/{realm}, retaining
context paths. Missing/invalid configuration produces null and the documented callback pattern.
No deployment repository wiring is needed for the null fallback.

Use requestConsoleSessionJson for all calls. The console-permissions action matches only
superadmin/tenant_owner/tenant_admin. Reuse the modal focus trap for template create/edit and the
existing destructive dialog for delete. Keep the password input uncontrolled and clear it before
awaiting submission; do not store it in page state. Duplicate alias validation is local UX only;
server upsert stays idempotent. Provider responses update only the provider list, retaining
unsaved login-setting drafts, and stale provider responses after tenant changes are ignored.
