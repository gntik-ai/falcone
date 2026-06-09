## Context

The audit pipeline already persists and queries events but no service monitors the stream for security anomalies. Three pieces of infrastructure exist but are unwired:

1. `services/audit/src/contract-boundary.mjs::capabilityEnforcementDeniedEvent` — defines the `capability_enforcement_denied` event schema (category `security`, fields including `tenantId`, `capability`, `reason`).
2. `services/internal-contracts/src/authorization-model.json` — defines `cross_tenant_violation` as an error class in both `security_context` and `authorization_decision` contracts.
3. `services/internal-contracts/src/index.mjs::getAlertOscillationDetection` (line 927) and `::getAlertSuppressionDefaults` (line 923) — live alert-infrastructure configuration already in use by the quota alerting path (`quota.threshold.alerts`, `observability-threshold-alerts.json:140`).

The reference implementation shape is `services/secret-audit-handler/src/index.mjs`: a tight loop of `createLogTailer` → `sanitize` → `publisher.publishAuditEvent`. The anomaly handler mirrors this loop but adds a stateful per-tenant window evaluator between consume and publish.

## Goals / Non-Goals

**Goals:**
- Build a new `services/audit-anomaly-handler/` service using the established tailer→publisher shape.
- Implement sliding-window detection for `cross_tenant_violation` and `capability_enforcement_denied` event categories.
- Emit scoped alerts to `console.security.alerts` using the existing oscillation/suppression machinery.
- Keep the existing audit pipeline path completely unmodified (no latency impact).

**Non-Goals:**
- UI or API surface for alert retrieval (out of scope for this increment).
- Detection rules beyond the two initial categories (`cross_tenant_violation`, `capability_enforcement_denied`).
- Schema registry or Avro serialisation changes.
- Modifying any existing service.

## Decisions

**Decision: Separate service, not a plugin in the existing audit service.**
Rationale: Mirrors the `secret-audit-handler` precedent; keeps the anomaly handler independently deployable and upgradeable without touching the hot audit persistence path.

**Decision: In-memory sliding window per tenant.**
Rationale: Low-risk (per proposal Risk = low) and sufficient for the initial increment. A persistent window (Redis / DB) is a follow-on if cross-pod consistency is required.

**Decision: Reuse `getAlertSuppressionDefaults` for deduplication.**
Rationale: The suppression contract is already authored and in production for quota alerts; using it avoids inventing a parallel suppression model.

**Decision: `console.security.alerts` as the output topic.**
Rationale: Consistent with the `console.*` topic namespace already used by `quota.threshold.alerts` and `console.secrets.audit`.

## Risks / Trade-offs

**Risk:** In-memory window state is lost on pod restart, potentially re-emitting an alert or missing events across a restart.
**Mitigation:** Acceptable for the initial increment; the suppression window is stateless at the consumer side. Document as known limitation; add persistent-window support as a follow-on.

**Risk:** High-volume audit streams could cause the handler to lag behind the pipeline, delaying alert emission.
**Mitigation:** The handler is a separate consumer group and does not block the primary audit consumer. Rate-limit the per-tenant window evaluation to avoid CPU saturation.

**Risk:** A tenant whose events are legitimately high-volume (e.g. during a load test) could generate false-positive alerts.
**Mitigation:** Thresholds are configurable via environment variables; operators can tune N and T per environment.

## Migration Plan

1. Create `services/audit-anomaly-handler/` with `src/index.mjs` (consumer loop), `src/anomaly-detector.mjs` (sliding-window logic), `src/rules.mjs` (threshold configuration), and `src/alert-publisher.mjs` (Kafka producer to `console.security.alerts`).
2. Wire the service into the deployment configuration (Helm chart / compose).
3. Write black-box tests before applying the implementation.
4. Run `bash tests/blackbox/run.sh` to confirm green.
