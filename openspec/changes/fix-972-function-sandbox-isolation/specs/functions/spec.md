## ADDED Requirements

### Requirement: Function runtime authenticates every invocation before source evaluation

The system SHALL verify an asymmetrically signed, control-plane-issued invocation credential before
evaluating `FN_SRC`, resolving `main`, or executing user code. The credential SHALL bind the ksvc
name as `aud`, target tenant ID, workspace ID, `iat`, `exp`, a nonempty `jti`, the request body and
verified caller identity. Its lifetime SHALL NOT exceed 60 seconds. Runtime verification SHALL
reject missing, malformed, unsigned, tampered, expired and wrong-target credentials with HTTP `401`.
Issuance time SHALL permit at most three seconds of clock skew; later future-issued credentials
SHALL be rejected. Health and readiness GETs SHALL remain unauthenticated and SHALL NOT run user code.
Expiry SHALL have no clock allowance; credentials at or after `exp` SHALL be rejected.

#### Scenario: Unauthenticated direct POST never evaluates source

- **WHEN** a caller POSTs to any runtime path without a valid invocation credential, including with
  forged `X-Falcone-*` identity headers
- **THEN** the runtime returns `401` and neither source evaluation nor `main` occurs

#### Scenario: A credential cannot cross workload ownership or its expiry window

- **WHEN** a credential minted for ksvc X is presented to ksvc Y, another tenant/workspace, with a
  changed body, a bad signature, or at or after its expiry
- **THEN** the runtime returns `401` without evaluating function source or executing `main`

#### Scenario: Valid invocation preserves verified caller context and activation recording

- **WHEN** an authorized caller invokes through `POST /v1/functions/actions/{id}/invocations`
- **THEN** the control plane signs the resolved workload and verified identity, waits for readiness,
  the runtime executes with claim-derived `main(params, context)`, returns `200`, and the control
  plane writes exactly one activation through the existing quota, metering and audit path
- **AND** forged identity headers and caller-like body fields do not change that context

### Requirement: Signing authority remains outside function sandboxes

The private key SHALL stay exclusively in the control plane, delivered through External
Secrets/OpenBao, never inline in chart values. Function revisions SHALL receive only public
verification keys, support overlapping keys by `kid`, and contain no signing material in env,
filesystem or memory. Credentials SHALL NOT be injected into function env or logged in runtime or
control-plane errors. Runtime configuration SHALL be captured before evaluating tenant code.

#### Scenario: Environment disclosure cannot forge another service credential

- **WHEN** a function returns its environment
- **THEN** no invocation private key or signing material is exposed and the public key cannot mint a
  credential for another ksvc

#### Scenario: Rotation and re-roll preserve existing resource ownership

- **WHEN** an operator re-applies a function's existing definition through PATCH after publishing
  overlapping public keys
- **THEN** the stable ksvc name and ownership checks are preserved, the pod label and public-key env
  are applied idempotently, and both configured signing key IDs can be verified

### Requirement: Function pods have targeted ingress and egress isolation

The system SHALL label function pod templates with `in-falcone.io/component: function`. The chart
SHALL provide an additive, default-enabled, toggle-gated NetworkPolicy selecting that label with
both Ingress and Egress policy types. Ingress SHALL allow only configured Knative data-plane
namespaces. Egress SHALL allow DNS and explicit configurable destinations without covering
`kourier-system`, `knative-serving`, or other function pods. No namespace-wide default-deny SHALL be
introduced. Documentation SHALL state that enforcing CNI evidence is required.

#### Scenario: Function-to-function traffic across tenants is refused

- **WHEN** tenant B's function attempts tenant A's cluster-local host on a policy-enforcing cluster
- **THEN** the request fails with refusal or timeout and A's activation total stays zero
- **AND** a legitimate control-plane invocation of B still succeeds from cold start

#### Scenario: Chart selectors match real function pods in every shipped profile

- **WHEN** the chart and a function pod fixture are rendered in any shipped values profile
- **THEN** `networkpolicy-selector-reality.test.mjs` proves that the policy selects the function pod,
  includes Ingress and Egress, and has no forbidden egress peer
- **AND** disabling the function policy toggle removes only this policy
