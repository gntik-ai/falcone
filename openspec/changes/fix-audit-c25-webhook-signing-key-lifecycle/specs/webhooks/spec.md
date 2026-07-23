## ADDED Requirements

### Requirement: Webhook master-key parsing is strict and has no fallback

The system SHALL resolve webhook master-key material once into a key context containing bytes, the
declared mode, and the opaque `WEBHOOK_SIGNING_KEY_ID`. Canonical-v1 parsing SHALL accept only `v1:`
plus the 43-character unpadded base64url encoding of exactly 32 bytes. Historical
32-byte-or-SHA-256 normalization SHALL be callable only by an explicit legacy adoption or recovery
state. Missing, empty, malformed, incompatible, wrong-identity, or unverifiable material SHALL fail
closed in every environment, and the system SHALL NOT use `development-signing-key` or any other
default.

#### Scenario: Canonical-v1 key resolves to exactly 32 bytes

- **WHEN** `WEBHOOK_SIGNING_KEY` is strict canonical-v1 material and the declared mode/opaque identity match lifecycle state
- **THEN** the resolved key context contains the exact decoded 32 bytes and is eligible for lifecycle verification

#### Scenario: Missing key has no development fallback

- **WHEN** `WEBHOOK_SIGNING_KEY` is missing or empty in development, test, staging, or production
- **THEN** key resolution fails closed before any webhook secret is encrypted/decrypted and no default string is substituted

#### Scenario: Malformed canonical input is not normalized

- **WHEN** canonical input contains padding, whitespace, an alternate alphabet, the wrong encoded/decoded length, trailing data, an unknown version, or a non-round-tripping encoding
- **THEN** parsing rejects it and never hashes or truncates it into an AES key

#### Scenario: Legacy normalization is unavailable during ordinary serving

- **WHEN** arbitrary legacy string material is supplied while lifecycle mode is canonical-v1 or no explicit legacy adoption/recovery is active
- **THEN** the system rejects the material and does not attempt historical SHA-256 normalization

#### Scenario: Stable identity with changed external bytes fails verification

- **WHEN** the namespace/Secret/key identity is unchanged but the supplied bytes cannot authenticate the lifecycle verification ciphertext
- **THEN** key verification fails closed and the consumer does not listen, become ready, or access subscription ciphertext

### Requirement: Migration 004 records non-secret webhook master-key lifecycle state

The system SHALL apply an additive, idempotent migration 004 that adds `encryption_key_id` to
`webhook_signing_secrets`, creates singleton `webhook_master_key_state`, and creates the idempotency and
audit ledger `webhook_master_key_rotations`. The state SHALL contain only non-secret key identities,
modes, lifecycle/recovery state, deadline, and key-verification ciphertext/IV. The ledger SHALL contain
only action, request/rotation IDs, source/target identities, state, bounded row counts, timestamps,
recovery deadline, and sanitized errors; neither table SHALL contain key bytes, encoded keys, key
digests, or decrypted subscription secrets.

#### Scenario: Migration is additive on a legacy database

- **WHEN** migration 004 is applied to a database with existing `webhook_signing_secrets` rows
- **THEN** all existing webhook rows and public data remain present, the new identity column and lifecycle tables exist, and no key identity is guessed or backfilled without explicit adoption

#### Scenario: Migration replay is a no-op

- **WHEN** migration 004 runs more than once during restart, retry, or upgrade
- **THEN** it completes without duplicate tables, columns, constraints, ledger records, or mutation of established lifecycle state

#### Scenario: Lifecycle verification stores ciphertext rather than a digest

- **WHEN** a current or recovery key is registered in lifecycle state
- **THEN** the system writes a fresh-IV authenticated encryption of the fixed verification sentinel and stores no digest or reversible representation of the key

#### Scenario: Rotation ledger is idempotent and secret-free

- **WHEN** adoption, rotation, recovery, or finalization records an outcome
- **THEN** the ledger uniquely binds the request/action/identities and records only sanitized metadata, counts, timestamps, deadline, and error state without key-derived or decrypted material

#### Scenario: Tenant database path cannot access platform lifecycle operations

- **WHEN** a normal webhook management or delivery operation uses its tenant-scoped database adapter
- **THEN** it can access only the tenant/workspace webhook rows needed by that operation and cannot read or mutate platform master-key lifecycle state/ledger through that adapter

### Requirement: Webhook consumers verify schema, key identity, and lifecycle before serving

The system SHALL await webhook schema migration, strict key resolution, lifecycle-state validation,
opaque identity matching, and verification-cipher authentication before `server.listen`, readiness, or
consumer processing. A canonical key MAY initialize absent singleton state only when the database has
no signing-secret rows. A database with existing rows but no complete lifecycle state SHALL require
explicit adoption. Incomplete, in-progress, expired, ambiguous, or `recovery_required` state SHALL
remain fail-closed.

#### Scenario: Empty fresh database initializes safely

- **WHEN** startup has a valid canonical-v1 key and the database has neither signing-secret rows nor master-key state
- **THEN** the system atomically initializes canonical current identity/verification state and listens only after that state verifies

#### Scenario: Existing rows without lifecycle state require adoption

- **WHEN** startup finds one or more signing-secret rows but no complete master-key state or missing row `encryption_key_id` values
- **THEN** startup fails closed with a sanitized adoption-required state and does not infer a key or listen

#### Scenario: Rotation or recovery ambiguity blocks readiness

- **WHEN** lifecycle state is `rotation_in_progress`, `recovery_required`, has conflicting row key identities, or otherwise cannot prove one serving key
- **THEN** the server and every webhook consumer remain stopped or unready and perform no webhook encryption/decryption

#### Scenario: Verified lifecycle permits serving

- **WHEN** migration, strict parsing, opaque identity, verification ciphertext, row key identities, and lifecycle state all agree on one serving key
- **THEN** the server may listen/become ready and all webhook crypto consumers use the single resolved key context

#### Scenario: Schema or key verification failure precedes listen

- **WHEN** schema application, key lookup, format validation, identity verification, or lifecycle reconciliation fails
- **THEN** no network listener or ready endpoint advertises successful service and Kubernetes can restart or hold the workload for operator recovery

### Requirement: Legacy webhook master-key adoption is explicit and atomic

The system SHALL adopt historical arbitrary-string material only through an explicit
`adoption.mode=legacy` maintenance operation with a unique request ID. The operation SHALL quiesce all
webhook master-key consumers, acquire exclusive advisory and transaction locks, verify every existing
row using the exact historical 32-byte-or-SHA-256 normalization, assign the declared opaque key
identity, and atomically establish legacy serving/verification state without changing per-subscription
plaintext. It SHALL NOT rotate implicitly to canonical-v1.

#### Scenario: Explicit legacy adoption preserves every secret

- **WHEN** all existing rows decrypt with the exact supplied historical material and the database has no conflicting lifecycle state
- **THEN** one transaction labels every row with the legacy key identity, establishes verified legacy serving state, and preserves each row's exact plaintext and all non-key columns

#### Scenario: Successful adoption retry is idempotent

- **WHEN** the same adoption request ID and key identity are submitted after that request committed
- **THEN** the operation returns the recorded result without decrypting, relabeling, or otherwise mutating rows again

#### Scenario: Adoption request ID cannot be rebound

- **WHEN** an existing adoption request ID is reused with a different action, mode, or key identity
- **THEN** the operation rejects the conflict and leaves established state and rows unchanged

#### Scenario: One incompatible row aborts adoption

- **WHEN** any existing row cannot be authenticated/decrypted with the declared historical material or rows reflect mixed/unknown key state
- **THEN** the transaction rolls back all row/state changes, records only a sanitized failure, and the database remains non-serving until corrected

#### Scenario: Legacy adoption does not perform canonical rotation

- **WHEN** explicit legacy adoption succeeds
- **THEN** lifecycle mode remains legacy with the exact historical normalized key and canonical rotation requires a later distinct request and new Secret identity

### Requirement: Platform master-key rotation is quiesced, transactional, and idempotent

The system SHALL expose platform master-key rotation only through the maintenance CLI/hook. Every
rotation SHALL use a source and a different target Secret name/key identity, quiesce and verify all
consumers, acquire an advisory/transaction lock, decrypt and re-encrypt every
`webhook_signing_secrets` row in one transaction, and atomically commit the target current identity,
source recovery identity, verification state, counts, and recovery deadline. It SHALL preserve exact
plaintext and every row ID, subscription ID, tenant/workspace ID, status, grace/revocation timestamp,
and other non-encryption field.

#### Scenario: Canonical rotation preserves data and behavior

- **WHEN** a verified legacy or canonical source rotates to a distinct valid canonical-v1 target while all consumers are quiesced
- **THEN** every row is re-encrypted with a fresh IV under the target, verification proves exact plaintext preservation, all non-encryption fields are unchanged, and target/current plus source/recovery state commits atomically

#### Scenario: Rotation cannot start while a consumer is active

- **WHEN** the maintenance operation cannot quiesce or prove the drain of every process that can encrypt or decrypt webhook signing secrets
- **THEN** it refuses to transform any row and leaves source serving state unchanged

#### Scenario: Same-identity rotation is rejected

- **WHEN** source and target resolve to the same namespace/Secret/key identity
- **THEN** rotation fails before row access even if an external manager changed the bytes behind that identity

#### Scenario: Failure before commit restores source serving

- **WHEN** key verification, row decryption/re-encryption, validation, lock/timeout, or database work fails before transaction commit
- **THEN** PostgreSQL rolls back every transformed row and lifecycle change, the old source remains authoritative, and source serving can resume without partial migration

#### Scenario: Ambiguous post-commit outcome fails closed

- **WHEN** commit acknowledgement, hook completion, or consumer rollout is lost or ambiguous after the transaction may have committed
- **THEN** lifecycle is reconciled as `recovery_required`, no source or target consumer serves speculatively, and only idempotent resume or explicit recover can restore serving

#### Scenario: Rotation retry with identical IDs resumes once

- **WHEN** the same request ID, rotation ID, source identity, and target identity are retried after interruption
- **THEN** ledger/state reconciliation returns or completes the one logical rotation without applying a second transformation

#### Scenario: Rotation identifiers cannot be reused for different inputs

- **WHEN** a request ID or rotation ID already belongs to different source/target identities, action, or recovery window
- **THEN** the operation rejects the conflict, emits a sanitized audit outcome, and leaves data/state unchanged

### Requirement: Recovery and finalization are explicit forward lifecycle operations

The system SHALL recover a committed or ambiguous rotation only through an idempotent fixed-version
maintenance operation that re-verifies the retained identities and, when necessary, decrypts and
re-encrypts all rows in one locked transaction. It SHALL NOT depend on Helm rollback. Finalization
SHALL be a separate idempotent action allowed only after verified stable serving and expiry of the
recovery window; it SHALL atomically remove recovery lifecycle state without changing tenant webhook
data.

#### Scenario: Resume completes a proven committed target

- **WHEN** reconciliation proves that the target transaction committed completely and target key/state verify
- **THEN** repeating the original request resumes the fixed target consumer and returns the recorded outcome without another row transformation

#### Scenario: Forward recovery restores the retained source

- **WHEN** target serving cannot be completed within the recovery window and both current and retained recovery identities verify
- **THEN** explicit `recover` quiesces consumers, transactionally re-encrypts every row to the selected retained identity if required, verifies all counts/plaintext, and commits one serving state

#### Scenario: Recovery custody is durable and cannot be relabeled

- **WHEN** `recover` declares managed/external target custody that differs from the custody recorded with the retained recovery identity, or an adopt/rotate/recover replay changes its target-custody flag
- **THEN** the operation fails closed with a bounded lifecycle conflict before changing signing-secret rows or lifecycle state; a successful recovery takes current custody from the durable prior recovery state, retains the durable prior current custody with the new recovery identity, and records those durable values in ledger and audit output

#### Scenario: Recovery failure remains fail-closed

- **WHEN** either required key is missing/incompatible, any row cannot decrypt, or lifecycle reconciliation is ambiguous
- **THEN** recovery rolls back, no consumer resumes, and state remains `recovery_required` with only sanitized diagnostic metadata

#### Scenario: Finalization after the deadline preserves webhook rows

- **WHEN** current serving state is verified, the recovery deadline has elapsed, and finalization uses a new valid request ID
- **THEN** the system removes recovery identity/verification metadata atomically while leaving every `webhook_signing_secrets` row and public webhook behavior unchanged

#### Scenario: Early or repeated finalization is safe

- **WHEN** finalization is attempted too early, against ambiguous state, or repeated after successful completion
- **THEN** an early/ambiguous request is rejected without mutation and an identical completed request is an idempotent no-op

### Requirement: Platform key lifecycle preserves tenant webhook contracts and controls

The system SHALL preserve per-subscription signing-secret plaintext, outbound public webhook
signature bytes/format, tenant/workspace predicates, isolation, authorization, subscription quotas,
row statuses, and all public webhook API contracts across adoption, rotation, recovery, and
finalization. Platform lifecycle operations SHALL NOT be reachable through tenant APIs or normal
tenant database adapters and SHALL NOT introduce a tenant role, gateway route, OpenAPI/SDK operation,
or quota bypass.

#### Scenario: Public signature is unchanged after master-key rotation

- **WHEN** the same subscription secret signs the same webhook payload before and after a successful platform master-key rotation
- **THEN** the public `x-platform-webhook-signature` value and verification behavior are identical because only at-rest wrapping changed

#### Scenario: Tenant and workspace isolation survives every lifecycle action

- **WHEN** adoption, rotation, recovery, or finalization processes rows for multiple tenants/workspaces
- **THEN** each row retains its original tenant/workspace identity and normal reads/writes continue to require the existing tenant/workspace predicates, with no cross-tenant disclosure or mutation

#### Scenario: Tenant subscription quota remains enforced

- **WHEN** a tenant creates subscriptions before or after a platform key lifecycle action
- **THEN** `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` and existing `QUOTA_EXCEEDED` behavior are unchanged and the maintenance operation grants no quota exemption

#### Scenario: Tenant-facing secret rotation remains distinct

- **WHEN** an authorized tenant rotates one subscription's signing secret through the existing public route
- **THEN** only that tenant-scoped subscription lifecycle changes, using the verified current platform key, and no platform master-key state or other tenant row is exposed or mutated

#### Scenario: Master-key operation has no public route

- **WHEN** a tenant, machine actor, constrained auditor, or cross-tenant actor probes the published webhook API
- **THEN** no adoption/rotate-master/recover/finalize operation is discoverable or invokable and existing authorization/not-found behavior remains unchanged

### Requirement: Runtime lifecycle status and failures are secret-safe

The system SHALL provide an operator read-only lifecycle status that reports only opaque key
identities, custody/mode, action/request/rotation identifiers, state, bounded counts/timestamps, and
recovery deadline. Runtime and maintenance success/failure paths SHALL NOT expose key bytes, encoded
keys, key digests, decrypted signing secrets, raw Secret objects, raw environment values, SQL
parameters, or unsanitized exceptions through logs, metrics, Events, CLI output, audit records, or
evidence.

#### Scenario: Constrained posture check needs no Secret data

- **WHEN** P4 or P10 runs the documented read-only status/reference checks without permission to read Kubernetes Secret data
- **THEN** they can confirm the configured reference, opaque identity, lifecycle state, counts, deadline, and serving/readiness posture without receiving secret material

#### Scenario: Crypto or database error is sanitized

- **WHEN** parsing, AES-GCM authentication, row migration, database commit, or lifecycle reconciliation throws an internal error
- **THEN** operator-visible output and persisted ledger/audit state use a bounded stable error code/message and do not include raw input, stack, SQL text/parameters, ciphertext plaintext, or key-derived data

#### Scenario: Observability cannot reveal canonical material

- **WHEN** logs, metrics, Events, pod descriptions, maintenance output, and test/live evidence are searched after successful and failed lifecycle operations
- **THEN** they contain no `v1:` key payload, historical literal, key digest, environment dump, or decrypted per-subscription signing secret
