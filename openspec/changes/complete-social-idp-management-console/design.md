# Design

Resolve the tenant and realm exclusively through authorizeAuthConfig/canManageTenant and the
verified caller/path. Validate alias, built-in providerId, config-key allow-list and scalar types
before Keycloak I/O. Read the existing provider before deciding create requirements; the adapter
rechecks existence before writing. Existing templates cannot change. Preserve metadata and all
stored config while applying only supplied fields. Empty/omitted secrets preserve the stored
secret, including when admin GET masks it. Keycloak 26.1.0 returns SECRET_VALUE (`**********`)
on admin GET; its IdentityProviderResource update replaces an unchanged SECRET_VALUE with the
stored credential before persistence. Retain that mask in read-merge-PUT to use this server-side
preservation contract. Caller-supplied masks remain invalid. The fake-Keycloak adapter regression
models masked GET and PUT substitution, checks edits with omitted/empty secrets and a config-less
toggle succeed, and asserts the stored credential never becomes literal stars. This is repository
test evidence; staging must still verify credential preservation and login before release.

If the provider disappears or changes template between the handler and adapter reads, the
adapter refuses incomplete creation/template changes without a write and the handler returns
400 VALIDATION_ERROR. The console always submits displayName and defaultScope: empty values
explicitly clear those settings, while omitted fields preserve them. An empty displayName is
stored as an empty string and the console displays the alias as its label.

Whitelist response fields at both adapter and handler boundaries. Do not retain upstream
social-provider response bodies in diagnostics. Keep the existing route audit descriptor, which
records tenant/path/status/outcome and does not copy request or response config.

Derive the public base from the existing KEYCLOAK_ISSUER URL by removing /realms/{realm}, retaining
context paths. Missing/invalid configuration produces null and the documented callback pattern.
No deployment repository wiring is needed for the null fallback.
The deployment values have no control-plane KEYCLOAK_ISSUER wiring (only executor wiring), so
the callback remains null in those environments. Product confirmation of whether a configured
callback URL is needed at release remains pending; the allowed path-pattern fallback is shipped.

Use requestConsoleSessionJson for all calls. The console-permissions action matches only
superadmin/tenant_owner/tenant_admin. Reuse the modal focus trap for template create/edit and the
existing destructive dialog for delete. Keep the password input uncontrolled and clear it before
awaiting submission; do not store it in page state. Duplicate alias validation is local UX only;
server upsert stays idempotent. Provider responses update only the provider list, retaining
unsaved login-setting drafts, and stale provider responses after tenant changes are ignored.
