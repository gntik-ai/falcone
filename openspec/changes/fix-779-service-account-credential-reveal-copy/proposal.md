## Why

The Service Accounts page described the credential-issuance panel as a one-time, unrecoverable
secret reveal:

- `Secreto visible una sola vez`
- `no podrá recuperarse después de cerrar este panel`

That contradicted the actual service-account credential lifecycle. The control-plane
`credential-issuance` handler reads the current Keycloak client secret, while
`credential-rotations` regenerates it and invalidates pre-rotation tokens. Repeating
credential issuance can therefore reveal the same current secret again by design. The false
one-time copy made the console promise stronger secret-handling semantics than the system provides.

The minimal safe fix is to make the UI, docs, and contract descriptions honest instead of changing
`credential-issuance` to silently rotate the secret. Rotation remains the explicit path for replacing
the secret and invalidating old tokens.

## What Changes

- **Web console copy**:
  - The Service Accounts row action is labeled `Revelar` instead of `Emitir`.
  - The reveal dialog says it shows the current service-account client secret, can be shown again,
    and points operators to `Rotar` when they need to replace the secret and invalidate tokens.
  - The rotate dialog uses distinct copy that labels the returned value as a newly generated secret
    and explains that rotation replaces the previous secret and invalidates pre-rotation tokens.
- **Tests**:
  - `ConsoleServiceAccountsPage.test.tsx` now drives the reveal flow and asserts the dialog does
    not contain the old one-time/unrecoverable wording, and does contain current-secret,
    reveal-again, and rotate guidance.
  - A focused rotate-copy assertion confirms the rotation path is still presented as the fresh-secret
    replacement path.
- **Docs and contract descriptions**:
  - `docs/reference/architecture/service-account-credential-lifecycle.md` explicitly distinguishes
    reveal (`credential-issuance`) from rotate (`credential-rotations`).
  - The unified OpenAPI summary for `issueServiceAccountCredential` describes a current-secret
    reveal; generated family OpenAPI, public route catalog, and public API docs are regenerated from
    that source.
  - The MCP official catalog text uses reveal/current-secret wording and points users to rotation for
    replacement.
- **Runtime behavior is unchanged**:
  - `credential-issuance` continues to return the current secret.
  - `credential-rotations` remains the explicit operation that regenerates the secret and invalidates
    pre-rotation tokens.

## Capabilities

### Modified Capabilities

- `web-console`: service-account credential reveal copy no longer claims one-time/unrecoverable
  semantics and instead matches the current-secret reveal behavior.
- `access-control`: service-account credential issuance is described in public API and route catalog
  artifacts as current-secret reveal, distinct from rotation.
