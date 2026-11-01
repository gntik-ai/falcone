# Implementation and validation

## Source repository

- [x] Verify the assigned clean worktree and issue branch at base `4fb15062ecd7fb665afb92952517482d98c35ebd`.
- [x] Read the supplied implement-issue execution contract and bounded chart ownership and upgrade documentation.
- [x] Add the proposal and specification delta for `fix-1511-console-audience-convergence`.
- [x] Confirm that source runtime changes and upgrade-guide diagnostic edits are unnecessary.
- [x] Pass strict OpenSpec validation, Markdown lint and whitespace checks.
- [x] Commit only the three source OpenSpec files locally.

## Companion deployment repository

These items are a handoff, not completed work in this source repository.

- [ ] At the rendered-bootstrap seam, reproduce `kc26-defaults` failure against base `557d118a` before changing chart source; record the command, symptom and confirmed cause.
- [ ] Implement identical desired-key convergence checks before writes and on readback, preserving desired string values and ignoring only extra configuration keys and provider metadata.
- [ ] Validate exactly one JSON array per response and safe mapper ids on both reads; handle every provider-file `jq` error with a fixed diagnostic.
- [ ] Add bounded, distinct failure diagnostics, cleanup and marker assertions without changing curl invocation style or token handling.
- [ ] Add missing, drifted, converged-with-extras and Keycloak 26 default-key cases, including a second run with zero writes.
- [ ] Add malformed-response, duplicate, lookup, write, invalid-id and readback-only regression cases, including missing and wrong desired keys.
- [ ] Make both fakes serve stored converged mappers without forced drift and add Keycloak 26 default keys to stored/readback mappers.
- [ ] Refresh the byte-identical `audience-reconciliation.txt` rendered fixture and explicitly update any intentional `currentBootstrapHash` change.
- [ ] Pass `node --test tests`, JWT policy snapshots, Keycloak 26 login-import, bootstrap and Helm render golden checks.

## Delivery owner and operator

- [ ] Reconcile the supplied R1 classification with the issue's R3 concern before merge; obtain human approval and both providers if R3 applies.
- [ ] Confirm Keycloak 26 returns desired configuration booleans as strings; preserve exact string comparison rather than accepting normalized values speculatively.
- [ ] After publication, verify that the `falcone-staging` bootstrap Job completes and Argo CD sync succeeds.
- [ ] Verify that exactly one console `in-falcone-audience` mapper carries the platform audience on staging.
