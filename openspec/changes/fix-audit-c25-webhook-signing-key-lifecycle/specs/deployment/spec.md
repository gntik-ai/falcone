## ADDED Requirements

### Requirement: Webhook master-key chart configuration is Secret-reference only

The system SHALL expose the webhook platform master-key deployment contract only at
`global.webhookSigningKey`, because `controlPlane` is an alias of the component-wrapper subchart. The
contract SHALL contain `create`, `secretName`, `secretKey`, `adoption.mode` (`none|legacy`),
`adoption.requestId`, `rotation.action` (`none|rotate|recover|finalize`), `rotation.requestId`,
`rotation.sourceSecretName`, `rotation.sourceSecretKey`, `rotation.rotationId`, and
`rotation.recoveryWindowSeconds`; it SHALL contain no inline key/value field. The chart SHALL reject a
reserved `WEBHOOK_SIGNING_KEY` name in every chart-inspectable control-plane env/config route,
including `controlPlane.env`, `global.transportSecurity.env`, and
`controlPlane.config.inline`, and SHALL inject exactly one `WEBHOOK_SIGNING_KEY` using
`valueFrom.secretKeyRef` with `optional: false`, plus only non-secret mode, opaque key identity, and
rollout annotations.

#### Scenario: Control plane receives exactly one required Secret reference

- **WHEN** valid `global.webhookSigningKey.secretName` and `secretKey` values are rendered
- **THEN** the control-plane workload contains exactly one `WEBHOOK_SIGNING_KEY` entry whose only key-material source is `valueFrom.secretKeyRef` with the configured name/key and `optional: false`

#### Scenario: Generic wrapper aliases do not receive the webhook key

- **WHEN** the umbrella chart renders all component-wrapper aliases
- **THEN** the dedicated webhook key, mode, identity, and rollout annotations are added only to the `controlPlane` workload and not to any other component

#### Scenario: Reserved direct environment or ConfigMap override is rejected

- **WHEN** `controlPlane.env` names `WEBHOOK_SIGNING_KEY` through `value` or `valueFrom`, `global.transportSecurity.env` names it while transport injection is enabled or disabled, or `controlPlane.config.inline` contains that map key
- **THEN** template rendering fails with a bounded sanitized configuration error, does not echo the supplied value, and produces no manifest

#### Scenario: Opaque envFrom references remain supported

- **WHEN** `controlPlane.envFromSecrets` or `controlPlane.envFromConfigMaps` references an external object whose keys Helm cannot inspect
- **THEN** the chart preserves that reference and the dedicated explicit `WEBHOOK_SIGNING_KEY` entry remains the authoritative environment value

#### Scenario: Inline key input is not accepted

- **WHEN** an operator supplies an undeclared inline/value field under `global.webhookSigningKey` or another deprecated literal-key input
- **THEN** strict values validation fails and no key material is rendered into a Secret, workload, ConfigMap, hook, or Helm release manifest

#### Scenario: Invalid lifecycle combination is rejected

- **WHEN** adoption or rotation values omit an action-required request, source identity, distinct target identity, rotation ID, or valid recovery window, or specify an unsupported enum value
- **THEN** the chart fails validation before any credential Job or workload lifecycle mutation begins

### Requirement: Managed webhook keys are generated and validated inside the cluster

The system SHALL use a pre-install/pre-upgrade in-cluster credential Job to generate or validate
webhook master-key material. A fresh managed key SHALL be formatted as `v1:` followed by the
43-character unpadded base64url encoding of exactly 32 cryptographically random bytes. Generation
SHALL never occur in Helm rendering or enter Helm values, output, release state, or history. Existing
managed material SHALL be strictly validated and reused byte-for-byte on ordinary upgrades, and
missing or incompatible material SHALL fail closed rather than regenerate implicitly.

#### Scenario: Fresh managed install creates canonical 256-bit material

- **WHEN** a fresh installation uses `create=true` and the requested managed Secret does not exist
- **THEN** the in-cluster Job creates an immutable retained Secret containing strict canonical-v1 material derived from exactly 32 newly generated random bytes without returning those bytes to Helm

#### Scenario: Ordinary upgrade preserves exact managed bytes

- **WHEN** an ordinary upgrade uses `rotation.action=none` and the chart-owned Secret already exists with valid canonical material
- **THEN** the Job validates and reuses the exact existing bytes without updating, patching, regenerating, or rotating the Secret

#### Scenario: Missing managed key on ordinary upgrade fails closed

- **WHEN** an ordinary upgrade expects an existing chart-owned current Secret but that Secret or key is absent
- **THEN** the upgrade fails before consumer rollout and does not generate a replacement key that could make persisted webhook ciphertext unreadable

#### Scenario: Explicit rotation creates only a new identity

- **WHEN** `rotation.action=rotate`, `create=true`, and the target Secret name/key identity is distinct from the source
- **THEN** the Job may generate canonical-v1 material at the new target identity while leaving the source Secret unchanged and retained for recovery

#### Scenario: Malformed canonical material is rejected

- **WHEN** referenced material has padding, whitespace, a non-base64url alphabet, an unknown version, a non-43-character payload, non-canonical encoding, or a decoded length other than 32 bytes
- **THEN** validation fails closed without normalizing, hashing, replacing, logging, or deploying the malformed material

### Requirement: Externally managed webhook Secrets remain externally owned

The system SHALL treat `create=false` as read-only validation of an externally managed Secret. The
chart and its Jobs SHALL NOT create, label as owned, update, patch, mutate, rotate in place, or delete
external Secrets. Every external rotation SHALL use a new namespace/name/key identity; changing bytes
behind the current identity is unsupported and SHALL be detected as an incompatible key state.

#### Scenario: Valid external Secret is consumed without mutation

- **WHEN** `create=false` references an existing Secret/key containing material valid for the declared lifecycle mode
- **THEN** the Job validates it read-only and the workload consumes it through the required `secretKeyRef` without changing the Secret resource or its data

#### Scenario: Missing external Secret fails closed

- **WHEN** `create=false` references a missing Secret or missing key
- **THEN** install or upgrade stops before consumer rollout and no substitute Secret or fallback value is created

#### Scenario: Same-name external rotation is rejected

- **WHEN** an external manager changes the bytes at the current namespace/name/key identity or an operator declares that same identity as both rotation source and target
- **THEN** lifecycle verification or chart validation rejects the state and consumers remain fail-closed until an explicit new-identity rotate or recover operation succeeds

#### Scenario: External recovery material is never deleted

- **WHEN** an explicit finalization completes for a lifecycle whose recovery Secret is externally managed
- **THEN** only lifecycle metadata is finalized and the external Secret is neither mutated nor deleted

### Requirement: Managed current and recovery Secrets have bounded explicit retention

The system SHALL retain chart-managed current and recovery Secrets across normal upgrades and chart
uninstall. A managed recovery Secret SHALL remain available until a successful explicit
`rotation.action=finalize` after the configured recovery deadline, and finalization SHALL delete only
a non-current Secret whose immutable identity and chart-ownership metadata match the recorded
lifecycle state.

#### Scenario: Upgrade and uninstall retain managed key custody

- **WHEN** a release is upgraded or uninstalled before lifecycle finalization
- **THEN** every chart-managed current and recorded recovery Secret remains present for forward recovery

#### Scenario: Premature finalization is rejected

- **WHEN** finalization is requested before the recovery deadline or while lifecycle state is incomplete, ambiguous, or unverified
- **THEN** no lifecycle metadata or Secret is removed and the request fails with a sanitized reason

#### Scenario: Eligible managed recovery Secret is finalized once

- **WHEN** the recovery deadline has elapsed, the current identity is verified serving, and the recorded recovery Secret has exact chart ownership metadata and is not current
- **THEN** explicit finalization removes the recovery association and may delete that managed recovery Secret exactly once

#### Scenario: Finalization cannot delete an ambiguous Secret

- **WHEN** the recorded Secret is current, externally managed, missing expected ownership metadata, or has a different identity than the request
- **THEN** deletion is refused and the operator receives a secret-safe conflict state

### Requirement: Deployment and operational evidence never disclose webhook key bytes

The system SHALL keep webhook master-key bytes and encoded key material out of workload literal
values, ConfigMaps, Helm values/history/rendered YAML, logs, metrics, Kubernetes Events, CLI arguments
and output, lifecycle metadata, and audit/test evidence. It SHALL expose only the Secret reference,
custody mode, lifecycle state, request/rotation identifiers, bounded counts/timestamps/deadline, and an
opaque key identity derived only from namespace/Secret/key names, so P4/P10 can verify posture without
Secret-data access.

#### Scenario: Rendered and stored Helm artifacts contain no key material

- **WHEN** the chart is linted, templated, installed, upgraded, or inspected with Helm
- **THEN** current templates, values, manifests, notes, hook specifications, and release data contain only non-secret references/lifecycle fields and never a literal or canonical key value

#### Scenario: Workload inspection proves reference posture without Secret read

- **WHEN** P4 or P10 can read the control-plane workload but cannot read Kubernetes Secret data
- **THEN** they can verify one required `secretKeyRef`, non-secret lifecycle mode/opaque identity, and rollout posture without gaining access to key bytes

#### Scenario: Failure evidence is secret-safe

- **WHEN** generation, validation, adoption, rotation, recovery, rollout, or finalization fails
- **THEN** logs, metrics, Events, audit records, command output, and captured evidence contain only sanitized codes and non-secret lifecycle identity and do not serialize environment variables, Secret objects, key bytes, key digests, or decrypted values

#### Scenario: Key is not passed as a command argument

- **WHEN** a credential or maintenance Job starts
- **THEN** no key material appears in container command/args or shell interpolation; the generator writes newly generated bytes directly to the Kubernetes API and the later validation/lifecycle process receives existing source/target bytes through required Secret references

### Requirement: Webhook key lifecycle releases and rollback are coordinated across repositories

The system SHALL release and deploy the lifecycle in this order: compatible Falcone application/image;
compatible chart values/schema/hooks/RBAC and image reference; Falcone CI `FALCONE_CHARTS_REF` pin;
environment-specific legacy adoption; separate canonical rotation; and later finalization. Adoption,
rotation, and recovery SHALL require an operational maintenance window, quiesced consumers, a tested
database backup, and custody of the matching source/recovery Secret. The only supported rollback
across a key transition SHALL be the fixed chart's forward `recover` operation.

#### Scenario: Cross-repository compatibility is pinned before environment migration

- **WHEN** the chart lifecycle contract is released for Falcone consumption
- **THEN** it references an image containing migration 004, strict parsing, startup gating, and the maintenance CLI, and Falcone CI pins and tests the compatible chart commit before environment adoption

#### Scenario: Legacy environment is adopted before canonical rotation

- **WHEN** an environment contains rows encrypted under the historical arbitrary-string normalization
- **THEN** the operator first performs explicit legacy adoption with the exact old bytes during a maintenance window and performs canonical-v1 rotation only as a later distinct request

#### Scenario: Backup and key custody are coupled

- **WHEN** adoption or rotation preflight runs
- **THEN** it requires a tested database backup and confirms custody by opaque identity of every source/recovery Secret needed to decrypt that backup for the full recovery window

#### Scenario: Unsafe Helm rollback is rejected by the runbook

- **WHEN** an operator needs to reverse a failed or committed key transition
- **THEN** documentation and automation direct them to an idempotent forward `recover` using the fixed chart and never to `helm rollback` to a revision that may render `WEBHOOK_SIGNING_KEY` as `env.value`

#### Scenario: Historical Helm literal remains an explicit hazard

- **WHEN** a pre-fix release revision remains in Helm storage after migration
- **THEN** the runbook identifies its disclosure/rollback risk, requires restricted release-history access and policy-compliant cleanup, and does not claim that installing the fixed revision erased historical copies

#### Scenario: Reference flow works on Kubernetes and OpenShift

- **WHEN** fresh install, upgrade, adoption, rotation, recovery, and finalization are exercised on disposable kind and OpenShift-compatible clusters
- **THEN** the hook security context, ServiceAccount, namespace-scoped RBAC, Secret reference, retention, and fail-closed rollout behavior satisfy the same lifecycle contract on both platforms
