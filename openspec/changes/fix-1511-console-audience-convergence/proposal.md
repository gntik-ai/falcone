# Fix console audience mapper convergence on Keycloak 26

## Why

Issue #1511 reports that the platform console audience reconciliation compares the complete mapper configuration with the desired payload. Keycloak 26.1.0 adds default configuration keys, including `introspection.token.claim` and `lightweight.claim`, so an otherwise correct mapper fails readback convergence and the bootstrap Job fails. Generic diagnostics hide the failing stage. Malformed responses and unchecked mapper ids also need explicit fail-closed handling.

## What changes

The companion `falcone-charts` ChangeSet changes only `ensure_console_audience` and its failure helper in `charts/in-falcone/templates/bootstrap-script-configmap.yaml`, plus their fixtures, tests and OpenSpec. It compares required fields and desired configuration keys, ignores extra provider keys, validates both response arrays and mapper ids, and emits bounded fixed diagnostics without provider values. The desired payload and platform audience stay unchanged.

This source repository adds only this proposal, tasks and specification delta. It does not contain the affected chart function or rendered-bootstrap tests. `docs/installation/shared-jwt-policy-upgrade.md` does not describe the diagnostic text and needs no edit. No source verifier, console, trust policy, workflow pin or dependency changes are required.

## Validation and handoff

The regression seam is the rendered bootstrap script executed against the fake Keycloak, rather than an isolated copy of a comparison expression. Before changing chart source, the deployment maker must run the `kc26-defaults` case against chart base `557d118a`, observe reconciliation failure, and record the actual command and symptom. That reproduction has not been run by this source maker; no runtime fix or runtime validation is claimed here.

The deployment maker must retain byte-identical rendered function text in `tests/blackbox/fixtures/jwt-policy-bootstrap/audience-reconciliation.txt`, extend both bootstrap fakes, run the chart and golden checks, and explicitly update any intentional `currentBootstrapHash` change. The source checks are strict OpenSpec validation, Markdown lint and whitespace validation.

## Boundaries and rollout

The assigned source branch is `agent/falcone/1511/884b5786-7b50-5f54-992f-9b3087b38559`, initially clean at `4fb15062ecd7fb665afb92952517482d98c35ebd`. The supplied policy assigns R1; the issue identifies an R3 authentication concern. This source documentation does not resolve or grant risk approval. The delivery owner must reconcile the classification before merge and obtain human approval and both providers if R3 applies.

No deployment, merge, push, credential access or staging command is authorized for this maker. Post-publication, the operator must verify the `falcone-staging` bootstrap Job, Argo CD sync and the console client's platform audience mapper. The #1505 trust-policy rollout and #1510 resource pruning remain outside this ChangeSet.
