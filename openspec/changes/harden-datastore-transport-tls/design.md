## Context

Falcone runs across two runtimes that each open their own datastore connections: the `apps/control-plane` runtime (plus standalone `services/*`), and a deliberately self-contained hand-built runtime under `deploy/kind/control-plane/*` that serves live `/v1/*` on the kind cluster. Neither enables TLS to Postgres, the document store (MongoDB wire), or Kafka. The chart already exposes some datastore TLS toggles (`ferretdb.tls.enabled`, `seaweedfs.enableSecurity`, `seaweedfsTls.bootstrap`) and edge TLS, but the application layer cannot consume any of it because connection construction never sets `ssl`/`tls`/`sasl`. There is no production values profile.

The `node-postgres` driver does not reliably honor `PGSSLMODE` when given an explicit `connectionString` (the DSNs here are built by hand), and self-signed/internal CAs need an explicit `ssl` object with a `ca` buffer anyway. The same is true for the MongoDB and KafkaJS drivers. So the fix must be in application code, driven by environment, not just an env var passed to the driver.

## Goals / Non-Goals

**Goals:**
- Make every app→datastore connection TLS-capable, driven entirely by environment, with a single shared resolver per protocol.
- Preserve the current plaintext default exactly (no TLS env ⇒ no behavior change) so dev/kind/all existing suites stay green.
- Fail closed in production when certificate verification is requested but the CA is missing/unreadable.
- Ship a coherent, render-tested production overlay that turns the whole posture on, including mounting CA material.

**Non-Goals:**
- At-rest envelope encryption of tenant documents (breaks FerretDB query/index) or objects (gateway-PUT path; limited SeaweedFS SSE). Secret material is already encrypted at rest; provider keys are `secretRef`-only.
- Provisioning a real internal CA / cert-manager issuer (operator responsibility; the overlay references a configurable existing secret).
- Edge/ingress TLS (already handled by `gatewayTls` + wildcard secrets).

## Decisions

**D1 — Pure env-driven resolvers in a shared module.** Add `services/internal-contracts/src/transport-security.mjs` exporting `resolvePostgresSsl(env)`, `resolveMongoTls(env)`, `resolveKafkaSecurity(env)` (and a `withPostgresSsl(config, env)` convenience). Each is a pure function of the environment, returning the exact driver option shape. This makes the security-sensitive logic unit-testable in isolation and identical across all call sites. Re-exported from `internal-contracts/src/index.mjs`. *Alternative considered:* sprinkle `ssl:` logic at each site — rejected (drift, untestable, inconsistent fail-closed).

**D2 — Local copy for the kind runtime.** The kind control-plane is a flat `/app` image whose Dockerfile COPYs top-level `.mjs` by name; resolving the `@in-falcone/internal-contracts` package from there is brittle. Add a behavior-identical `deploy/kind/control-plane/transport-security.mjs`, COPY it in the Dockerfile, and import it from `server.mjs`/`pg-handlers.mjs`/`mongo-handlers.mjs`/`kafka-handlers.mjs`/`dataplane.mjs`. A black-box test asserts the two copies are behavior-identical so they cannot drift. *Alternative considered:* cross-root relative import (`/app` → `/repo/services/...`) — rejected (fragile, depends on image layout).

**D3 — Env contract.**
- Postgres: `PGSSLMODE ∈ {disable,allow,prefer,require,verify-ca,verify-full}` (+ `PGSSLROOTCERT` path). `disable`/`allow`/`prefer`/unset ⇒ `false` (plaintext; `prefer` treated as off because the hand-built DSNs can't negotiate opportunistically and we keep the safe explicit default). `require` ⇒ `{ rejectUnauthorized:false }`. `verify-ca`/`verify-full` ⇒ `{ rejectUnauthorized:true, ca:<PGSSLROOTCERT> }`.
- Mongo: `MONGO_TLS` truthy ⇒ `{ tls:true, tlsCAFile?:MONGO_TLS_CA_FILE, tlsAllowInvalidCertificates?:true when MONGO_TLS_INSECURE }`.
- Kafka: `KAFKA_SSL` truthy ⇒ `ssl:true` or `{ ca:[readFile(KAFKA_SSL_CA_FILE)] }`; SASL from `KAFKA_SASL_MECHANISM`/`KAFKA_SASL_USERNAME`/`KAFKA_SASL_PASSWORD` (preserving the existing provisioning collector behavior).

**D4 — Fail-closed only in production, only when verifying.** `NODE_ENV=production` + verify mode + missing/unreadable CA ⇒ throw. Non-production never throws (eases local TLS experiments). `require` (no verification) never throws. Mirrors the `FLOW_TRIGGER_SECRET_KEY` fail-closed idiom (#636).

**D5 — Production overlay only sets values that are actually consumed.** `deploy/kind/values-production.yaml` sets the new TLS env + flips the existing chart toggles + https endpoints, plus a `transportSecurity.caSecret` reference. Chart templating mounts that secret and injects the CA-path env into the control-plane/executor/worker pods. Nothing aspirational is added.

## Risks / Trade-offs

- [Live mTLS not fully exercisable on kind: the bundled Postgres/FerretDB/Kafka may not present server certs] → Unit/black-box tests cover the resolver contract exhaustively (the security logic); live verify is best-effort (assert plaintext default still connects; assert `require` attempts TLS) and documented as such.
- [A wrong default could break every connection at once] → Default path returns "no TLS" and is asserted by tests across all sites; existing suites are the regression gate.
- [Two copies of the resolver could drift] → A black-box test imports both and asserts identical outputs over a matrix of envs; the kind copy has no independent logic.
- [`prefer` semantics differ from libpq] → Documented as treated-as-off; operators wanting TLS use `require`+.

## Migration Plan

1. Land resolvers + wiring with default-off behavior (no operational change).
2. Operators opt in by applying `values-production.yaml` (or setting the TLS env) once their datastores present certs and a CA secret exists.
3. Rollback: remove the overlay / unset the TLS env → connections revert to plaintext immediately; no schema or data changes.

## Open Questions

- Whether to later add a `data-residency`/`secrets`-style at-rest follow-on for object SSE — tracked separately, out of this change.
