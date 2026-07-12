# Service-account credential lifecycle and token invalidation

A *service account* is a machine identity for a workspace: a Keycloak confidential client
(`clientId = sa-<workspace>-<name>`) in the tenant realm. Machine clients (the P3 external-app
persona) obtain an OAuth `client_credentials` access token from the tenant realm's token endpoint and
present it as a Bearer token to the control-plane and tenant data-plane APIs.

## Endpoints

All routes are workspace-scoped and require a tenant owner/admin (or superadmin) caller.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/workspaces/{workspaceId}/service-accounts` | Create a service account (KC confidential client + registry row). |
| GET | `/v1/workspaces/{workspaceId}/service-accounts` | List all service accounts in the workspace. The console uses this as its source of truth, independent of browser/session state. |
| GET | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}` | Fetch one service account. |
| POST | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance` | Return the current client secret + token endpoint. |
| POST | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations` | Rotate the client secret. |
| POST | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations` | Revoke the credential. |

## Reveal vs rotate

`credential-issuance` is a **reveal** operation for the current Keycloak client secret. It returns
the active client id, current client secret, token endpoint, grant type, and issue timestamp so an
operator can recover the value needed for a `client_credentials` grant. It does not generate a new
secret, does not invalidate existing tokens, and may reveal the same current secret again until the
credential is rotated or revoked.

`credential-rotations` is the replacement path. It regenerates the Keycloak client secret and stamps
`credentials_invalidated_at`, so tokens minted from the pre-rotation secret are invalidated within
the propagation window described below. Use rotation when the operator wants a fresh secret or wants
to retire a previously disclosed value.

## Token validation

The control-plane (`apps/control-plane/server.mjs`) and the executor
(`apps/control-plane-executor/src/runtime/server.mjs`) verify each Bearer token **offline**: RSA signature
against the realm JWKS, `exp`/`nbf` (with a clock tolerance), trusted issuer (the platform realm or a
per-tenant realm under the same Keycloak base), and audience for the platform realm. A token that
fails any of these is rejected with `401 INVALID_TOKEN`.

## Revocation and rotation invalidate already-issued tokens (bounded window)

Revoking or rotating a service-account credential takes effect for **already-issued** access tokens
within a bounded propagation window — not only for newly requested tokens.

- **Revoke** (`credential-revocations`) disables the Keycloak client, regenerates its secret (so a
  new `client_credentials` grant with the old secret fails `401 invalid_client`), sets the registry
  row `status = 'revoked'`, and stamps `service_accounts.credentials_invalidated_at = NOW()`.
- **Rotate** (`credential-rotations`) regenerates the secret and stamps
  `service_accounts.credentials_invalidated_at = NOW()`, so tokens minted from the **pre-rotation**
  secret are cut off while tokens minted after the rotation keep working.

After offline validation passes, the verifier runs a service-account–only revocation check:

1. It looks only at service-account tokens — those whose authorized party (`azp`, with `clientId` /
   `client_id` tolerated) starts with `sa-`. **User and owner tokens are never affected** and incur
   no datastore lookup.
2. It resolves the service account by **client id AND realm**, and rejects the token (`401`) when the
   account is `revoked`, or when the token's `iat` predates `credentials_invalidated_at`. A datastore
   error fails closed (the service-account token is rejected).

### Realm-scoped lookup (cross-tenant safety)

The Keycloak client id is `sa-<workspace-slug>-<name>`, and a workspace slug is unique only *within a
tenant* — so two different tenants can each own a service account with the **same** client id. The
revocation lookup is therefore scoped by the service account's **realm**, which equals the tenant id
and is taken from the token's **cryptographically-verified issuer** (never a forgeable claim). The
registry read is `WHERE kc_client_id = ? AND iam_realm = ?` and the per-request cache is keyed on
`(realm, client id)`. Consequences:

- Revoking (or rotating) tenant A's `sa-acme-repro` rejects tenant A's tokens only; tenant B's
  same-named service account keeps working.
- Service accounts exist only in per-tenant realms, so a service-account token whose issuer is the
  platform realm (or any issuer from which a tenant realm cannot be derived) **fails closed**.

A defense-in-depth `UNIQUE (iam_realm, kc_client_id)` index codifies the per-realm uniqueness invariant
(creation falls back to a non-unique composite index if a legacy duplicate would otherwise block boot).

### Rotation cutoff granularity and the residual same-second window

Keycloak issues `iat` at **whole-second** resolution while the cutoff (`credentials_invalidated_at`)
is a millisecond Postgres timestamp. The check compares at second granularity with a small skew
(`SA_REVOCATION_SKEW_SEC`, default `1`): a token minted in an earlier second than the rotation — minus
the skew — is rejected, so a token minted **≥ 2 seconds before** a rotation is always cut off, while a
post-rotation token (minted at or after the rotation second) is never falsely rejected. A token minted
in the **same whole second** as the rotation is an inherent, unavoidable `< 1 s` blind spot of
second-granularity `iat`; it is accepted (it may legitimately be a post-rotation token). This skew is
separate from the JWT `exp`/`nbf` clock tolerance, which is unchanged.

### Propagation window — `SA_REVOCATION_CACHE_MS`

The per-client-id lookup is cached so the auth path does not query Postgres on every request. The
cache TTL is the **upper bound** on how long a revoked/rotated credential's existing token can still
be accepted.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SA_REVOCATION_CACHE_MS` | `10000` (10 s) | Revocation/rotation propagation window for already-issued service-account tokens. `0` disables caching (immediate propagation, one datastore read per request). An unset/blank value uses the default (only an explicit finite number overrides). |
| `SA_REVOCATION_SKEW_SEC` | `1` | Clock-skew allowance (seconds) for the rotation watermark — a token minted within this many seconds *after* the cutoff is still accepted. Keep it small (`≤ 1`) so a token minted ≥ 2 s before a rotation is reliably rejected. Distinct from the JWT `exp`/`nbf` clock tolerance. |

Set them on both the control-plane and the executor deployments to keep their windows consistent.

### Example

```bash
# Reveal the current credential secret and mint a token.
ISS=$(curl -s -X POST -H "Authorization: Bearer $OWNER" --data-binary '{}' \
  "$GW/v1/workspaces/$WS/service-accounts/$SA/credential-issuance")
CID=$(jq -r .clientId <<<"$ISS"); SEC=$(jq -r .clientSecret <<<"$ISS")
TOKEN=$(curl -s -d grant_type=client_credentials -d "client_id=$CID" -d "client_secret=$SEC" \
  "$KC/realms/$REALM/protocol/openid-connect/token" | jq -r .access_token)

# Revoke the credential.
curl -s -X POST -H "Authorization: Bearer $OWNER" --data-binary '{}' \
  "$GW/v1/workspaces/$WS/service-accounts/$SA/credential-revocations"   # -> {"status":"revoked"}

# Within SA_REVOCATION_CACHE_MS the already-issued token stops working.
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$GW/v1/console/session"                                              # -> 401 (was 200 until ~natural expiry)
```

## Console UX: credential-disclosure modal and status badge (#783)

`apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx` is the console surface for the
endpoints above. Its "Revelar"/"Rotar" actions open `CredentialDisclosureDialog`, a true,
action-anchored modal built on the shared `Dialog`/`DialogContent` primitive plus the
`useModalFocusTrap` hook (see
[`console-destructive-confirmation.md`](./console-destructive-confirmation.md#focus-management-tab-trap-and-focus-return-783)
for the shared trap/return mechanics):

- `role="dialog"` + `aria-modal="true"`, Tab-trapped, with focus returning to the "Revelar"/"Rotar"
  row action that opened it once it closes (Escape or the "Cerrar" button).
- Displays the credential's `credentialId` and `expiresAt` (both already returned by
  `credential-issuance`/`credential-rotations`, see above) alongside the secret value.
- The "Copiar" control confirms success (`role="status"`, `aria-live="polite"`) and degrades to an
  inline instruction to select-and-copy manually when `navigator.clipboard` is unavailable — it
  never throws.

Each service account's credential state (`active` / `rotated` / `revoked` / an `expired` state a
caller may report) is rendered by `ConsoleCredentialStatusBadge`, which color-encodes it — emerald
for `active`, violet for `rotated`, red/destructive for `revoked`, amber for `expired` — instead of
an identical neutral pill for every state. An unrecognized or missing status still renders the
original neutral outline tone.

**Revoking is terminal.** Unlike a revoked-but-still-listed service account (which can still be
deleted — see the #687 note below), a revoked credential itself has no path back to a usable state:
`credential-issuance`/`credential-rotations` both reject it with `409 CREDENTIAL_REVOKED` (see
above). The console's revoke confirmation (`WARNING`-level,
`DestructiveConfirmationDialog`/`useDestructiveOp`) states this explicitly — the credential can
never be re-issued or rotated again, and using the service account again requires deleting it and
creating a new one — so an operator does not expect an "un-revoke" or re-issue option afterward.
Deleting the service account (`CRITICAL`-level, `DELETE
/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}`) remains available for both an
active and a revoked account (#687), which is the actual path back to a usable credential under
the same display name.
