## 1. Reproduce / encode the contract

- [x] 1.1 Confirm the root cause from the issue/source trace: `credential-issuance` reads the
  current Keycloak client secret, while `credential-rotations` regenerates it.
- [x] 1.2 Add a focused web-console test for the Service Accounts reveal flow: after clicking the
  reveal action, the dialog must not contain one-time/unrecoverable wording and must contain
  current-secret, reveal-again, and rotate guidance.
- [x] 1.3 Add a focused assertion that rotation is still presented as the fresh-secret replacement
  path.

## 2. Fix

- [x] 2.1 Update the Service Accounts action/dialog copy so credential issuance is presented as
  revealing the current client secret, not issuing a one-time unrecoverable secret.
- [x] 2.2 Keep rotation distinct in the UI as the operation that generates a new secret and
  invalidates tokens minted with the previous secret.
- [x] 2.3 Update the local UI verification script to drive the renamed reveal action.

## 3. Docs / contract

- [x] 3.1 Update the service-account credential lifecycle architecture doc to explicitly contrast
  reveal vs rotate.
- [x] 3.2 Update the unified OpenAPI operation summary for `issueServiceAccountCredential` and
  regenerate public API artifacts.
- [x] 3.3 Update the MCP official catalog text for service-account credential issuance.
- [x] 3.4 Add this OpenSpec change under
  `openspec/changes/fix-779-service-account-credential-reveal-copy/`.

## 4. Verify

- [x] 4.1 Run focused web-console Vitest for `ConsoleServiceAccountsPage`.
- [x] 4.2 Run public API/OpenAPI validation and confirm generation is clean.
- [x] 4.3 Run OpenSpec validation if the CLI is available.
- [x] 4.4 Run `git diff --check`.
