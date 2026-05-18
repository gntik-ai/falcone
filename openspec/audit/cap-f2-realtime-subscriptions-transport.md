# Capability F2 — Realtime Subscriptions Transport

**Source locus (what actually exists in this repo):**
- `charts/realtime-gateway/` — standalone Helm chart, 5 files:
  - `Chart.yaml` (3 LOC)
  - `values.yaml` (40 LOC) — declares `image: ghcr.io/falcone/realtime-gateway:latest` and env vars 1-for-1 with the B2 library's `config/env.mjs`.
  - `templates/deployment.yaml` (69 LOC) — Deployment + env from `values.yaml`, health probes on `/healthz/{live,ready}`.
  - `templates/configmap-apisix-plugin.yaml` (13 LOC) — JWT-auth plugin config snippet.
  - `templates/secret-ref.yaml` (10 LOC) — `Secret` with three empty `stringData` keys.
- `services/gateway-config/routes/capability-gated-routes.yaml:18-22` — gates `/v1/workspaces/*/realtime[/*]` and `GET /v1/events/subscribe` behind the `realtime` capability flag (no upstream specified).
- `charts/in-falcone/values.yaml:23-28, 36-45, 55-59, 75-83` — umbrella public-surface bindings for the `realtime` hostname and the TLS/LoadBalancer config.
- `charts/in-falcone/values.yaml:839-846` — APISIX route 1003 `/realtime/*`, `enableWebsocket: true`, upstream `component: controlPlane`, port 8080.
- `charts/in-falcone/values.yaml:1126-1142` — APISIX route 2011 `/v1/websockets/*`, `enableWebsocket: true`, upstream `component: controlPlane`, port 8080.
- `charts/in-falcone/values.yaml:1175-1206` — Routes 2014/2015 with URIs `/v1/realtime/workspaces/{workspaceId}/mongo-captures/*` and `/v1/realtime/tenants/{tenantId}/mongo-captures/summary/*` (despite the URL prefix, these are `mongo-captures` family routes, not WS subscriptions).
- `apps/control-plane/openapi/families/websockets.openapi.json:557-690+` — OpenAPI declarations for `POST /v1/websockets/sessions` (`createWebSocketSession`, 202 + `Idempotency-Key`) and `GET /v1/websockets/sessions/{sessionId}` (`getWebSocketSession`). Both carry `x-owning-service: event_gateway`, `x-rate-limit-class: realtime`, `x-downstream-adapters: ["kafka"]`.
- `services/realtime-gateway/` — the B2 library (1273 LOC of Node code) — exposes `validateToken`, `createSessionManager`, `checkScopes`, audit publisher, filter parser/evaluator. **Library only; no HTTP/WS server.**
- Tests: `tests/e2e/realtime/*.test.mjs`, `tests/integration/realtime/*.test.mjs`, `tests/integration/realtime-gateway/*.test.mjs`, `tests/unit/realtime-gateway/*.test.mjs`. The e2e tests use `tests/e2e/realtime/helpers/client.mjs` (a WebSocket client).

**Method.** Started from the capability map's TODO ("transport binary's source location was not pinpointed"). Searched the entire repo for `WebSocket`/`WebSocketServer`/`ws.Server`/`new WebSocket`/`onUpgrade`/`text/event-stream`/`EventSource`. Read every chart file, every relevant APISIX route in the umbrella `values.yaml`, the websockets OpenAPI fragment, and the gateway-config capability-gating manifest.

**Headline finding up front:** the transport binary is **not in this repo**. The chart deploys a remote container image (`ghcr.io/falcone/realtime-gateway:latest`) whose source the audit could not locate. The umbrella APISIX route table does not send any traffic to the standalone chart's Deployment, and the standalone chart ships no `Service` template — so even if the binary existed and ran, there is no path through the cluster's networking that would reach it. F2 as drawn in the capability map is **a four-way stranded stack**: an OpenAPI declaration, a capability gate, a chart for a remote image, and a library — none of them wired together in source. Whatever realtime subscriptions actually run in production rely on out-of-repo glue.

---

## SPEC (what exists)

### S1. Public-surface binding (umbrella chart)

- **WHEN** the umbrella chart is rendered, **THE SYSTEM SHALL** publish a public-surface hostname `realtime: realtime.dev.in-falcone.example.com` (`charts/in-falcone/values.yaml:36`), terminate TLS via secret `in-falcone-dev-realtime-tls` (`:43`), and bind the `realtime` surface to the APISIX component at path `/realtime` on port 443 (`:55-59, 82`).
- **WHEN** the LoadBalancer ports are configured, **THE SYSTEM SHALL** expose `realtime: 443` (`charts/in-falcone/values.yaml:82`).

### S2. APISIX routes (umbrella chart)

- **WHEN** route 1003 is rendered, **THE SYSTEM SHALL** match `uri: /realtime/*`, enable WebSocket (`enableWebsocket: true`), set `priority: 80`, and forward to upstream `component: controlPlane` on port 8080 (`charts/in-falcone/values.yaml:839-846`).
- **WHEN** route 2011 (`public-api-websockets`) is rendered, **THE SYSTEM SHALL** match `uri: /v1/websockets/*` with the standard public-API methods, enable WebSocket, set `priority: 229`, label `gateway.in-falcone.io/family: websockets` with `tenant-binding: required, workspace-binding: required, plan-capabilities: data.kafka.topics, audit-required: "false"`, and forward to upstream `component: controlPlane` on port 8080 (`charts/in-falcone/values.yaml:1126-1142`).
- **WHEN** routes 2014/2015 are rendered, **THE SYSTEM SHALL** match `uri: /v1/realtime/workspaces/{workspaceId}/mongo-captures/*` (resp. `/v1/realtime/tenants/{tenantId}/mongo-captures/summary/*`) but route to the `mongo-captures` / `mongo-capture-tenant-summary` families on controlPlane (these are admin endpoints whose URI accidentally contains the substring "realtime") (`charts/in-falcone/values.yaml:1175-1206`).

### S3. Capability gating (gateway-config)

- **WHEN** an incoming request matches `/v1/workspaces/*/realtime`, `/v1/workspaces/*/realtime/*`, or `GET /v1/events/subscribe`, **THE SYSTEM SHALL** require the tenant's `realtime` capability flag to be enabled (`services/gateway-config/routes/capability-gated-routes.yaml:18-22`).

### S4. OpenAPI contract (websockets family)

- **WHEN** a client calls `POST /v1/websockets/sessions`, **THE SYSTEM SHALL** require headers `X-API-Version: 2026-03-26`, `X-Correlation-Id`, `Idempotency-Key`, and a JSON body matching `WebSocketSessionWriteRequest`, returning `202` with `GatewayMutationAccepted`; error responses are 400/403/413/429/431/504 with `ErrorResponse` (`apps/control-plane/openapi/families/websockets.openapi.json:557-689`).
- **WHEN** a client calls `GET /v1/websockets/sessions/{sessionId}` with a path parameter matching `^wss_[0-9a-z]+$`, **THE SYSTEM SHALL** return session metadata (`websockets.openapi.json:691-…`).
- **WHEN** the OpenAPI spec is consumed, **THE SYSTEM SHALL** declare `x-owning-service: event_gateway`, `x-downstream-adapters: ["kafka"]`, `x-rate-limit-class: realtime`, `x-resource-type: websocket_session`, `x-scope: workspace` (`websockets.openapi.json:680-688`).

### S5. Standalone realtime-gateway chart

- **WHEN** the standalone `charts/realtime-gateway` chart is installed, **THE SYSTEM SHALL** deploy a single Deployment named `realtime-gateway` running the image `ghcr.io/falcone/realtime-gateway:latest` on container port 8080 (`charts/realtime-gateway/values.yaml:1-9`, `templates/deployment.yaml:1-20`).
- **WHEN** the Deployment starts, **THE SYSTEM SHALL** populate env vars `KEYCLOAK_JWKS_URL`, `KEYCLOAK_INTROSPECTION_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_ID`, `JWKS_CACHE_TTL_SECONDS=300`, `SCOPE_REVALIDATION_INTERVAL_SECONDS=30`, `TOKEN_EXPIRY_GRACE_SECONDS=30`, `MAX_FILTER_PREDICATES=10`, `MAX_SUBSCRIPTIONS_PER_WORKSPACE=50`, four `AUDIT_KAFKA_TOPIC_*` topic names (`console.realtime.{auth-granted, auth-denied, session-suspended, session-resumed}`), plus secrets `DATABASE_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`, `KAFKA_BROKERS` from a `realtime-gateway-secrets` Secret (`charts/realtime-gateway/values.yaml:16-39`, `templates/deployment.yaml:21-60`).
- **WHEN** the Deployment is probed, **THE SYSTEM SHALL** answer `GET /healthz/ready` and `GET /healthz/live` on port 8080 (`charts/realtime-gateway/templates/deployment.yaml:61-68`).
- **WHEN** the chart is rendered, **THE SYSTEM SHALL** create the empty `realtime-gateway-secrets` Secret with three placeholder keys (`charts/realtime-gateway/templates/secret-ref.yaml:1-9`).
- **WHEN** the chart is rendered, **THE SYSTEM SHALL** create an APISIX-plugin ConfigMap exposing `jwt-auth.yaml` with `jwks_uri` and `realm` (`charts/realtime-gateway/templates/configmap-apisix-plugin.yaml:1-13`).

### S6. Authorization library consumed by the deployed image

- **WHEN** a process running the image starts (assumed by env-var contract match), **THE SYSTEM SHALL** consume `services/realtime-gateway/src/` (the B2 library — `loadEnv`, `validateToken`, `createSessionManager`, `checkScopes`, `publishAuthDecision`, `parseFilter`, `evaluateFilter`, `guardEvent`). The library's full FRs are in the B2 audit (`openspec/audit/cap-b2-realtime-auth-scope-validation.md`).

---

## GAPS

### G1. The transport binary is not in this repo.

The chart deploys `ghcr.io/falcone/realtime-gateway:latest` (`charts/realtime-gateway/values.yaml:1-3`). `grep -rn "ghcr.io/falcone/realtime-gateway" /home/andrea/Documents/falcone` returns only the chart values and the B2 library's `package.json`. The Dockerfile that builds this image, the server bootstrap (HTTP listen, WS upgrade handler, SSE writer), the route handlers for `POST /v1/websockets/sessions`, and the streaming pipeline that pulls from Kafka into open WS connections — none are in this repo.

### G2. The standalone chart has no Service.

`charts/realtime-gateway/templates/` lists `Chart.yaml`, `configmap-apisix-plugin.yaml`, `deployment.yaml`, `secret-ref.yaml`, `values.yaml`. **There is no `Service` template.** `values.yaml:8-9` declares `service.port: 8080`, but no template materialises it. Even if the binary existed and started, no other pod in the cluster could reach it by DNS. K8s readiness/liveness probes (`deployment.yaml:61-68`) would work because they use pod IP, but APISIX upstream resolution by service name would fail.

### G3. The umbrella chart does not route to the standalone deployment.

`charts/in-falcone/values.yaml` declares only `controlPlane`, `webConsole`, `keycloak`, etc. as upstream components. **There is no `realtimeGateway` component**. Route 1003 (`/realtime/*`, websocket-enabled) targets `component: controlPlane` on port 8080 (`:839-846`). Route 2011 (`/v1/websockets/*`) also targets `controlPlane` (`:1140-1142`). The standalone chart is therefore deployed but unrouted by the umbrella; whoever installs it must wire APISIX manually out-of-repo.

### G4. The capability-gated paths have no upstream definition.

`services/gateway-config/routes/capability-gated-routes.yaml:18-22` declares `/v1/workspaces/*/realtime[/*]` and `GET /v1/events/subscribe` as capability-gated. The umbrella chart's APISIX routes do not include these paths — `/v1/workspaces/*/realtime*` is matched by no route in `charts/in-falcone/values.yaml`. So the gates protect routes that don't exist in the deployed APISIX route table.

### G5. `x-owning-service: event_gateway` is wrong relative to source.

`apps/control-plane/openapi/families/websockets.openapi.json:684` declares the owning service as `event_gateway`. F1 audit established that `services/event-gateway/src/` is a pure compiler/validator with no HTTP/WS handlers. The route 2011 in the umbrella chart sends `/v1/websockets/*` to `controlPlane`. The control-plane source under `apps/control-plane/src/` is itself a contract façade (per A1 audit). Neither service contains a `createWebSocketSession` handler.

### G6. No handler exists for `GET /v1/events/subscribe`.

Cited in the capability map's F1 entry and gated in `capability-gated-routes.yaml`. The F1 runtime exports a `validateEventSubscriptionRequest` validator but no server. No APISIX route in `charts/in-falcone/values.yaml` matches `/v1/events/subscribe`.

### G7. Routes 2014/2015 misuse the `/v1/realtime/` URL prefix for non-realtime endpoints.

`charts/in-falcone/values.yaml:1177, 1193` define mongo-captures admin routes under `/v1/realtime/workspaces/{workspaceId}/mongo-captures/*`. These are not WebSocket endpoints (no `enableWebsocket: true`) and not realtime subscriptions — they are CRUD admin for capture configuration. The URL prefix is misleading and will collide in operator/customer mental models with the `realtime` capability surface.

### G8. The `realtime-gateway-secrets` Secret is shipped with empty values.

`charts/realtime-gateway/templates/secret-ref.yaml:6-9` creates the Secret with literal `""` values for `DATABASE_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`, `KAFKA_BROKERS`. The B2 library at `services/realtime-gateway/src/config/env.mjs:23-29` throws "Missing required environment variable" when these are empty. Without an out-of-repo step that populates the Secret (e.g., External Secrets Operator), the deployed pod would crash-loop on startup.

### G9. The standalone chart's APISIX-plugin ConfigMap is never consumed in source.

`charts/realtime-gateway/templates/configmap-apisix-plugin.yaml:1-13` emits a ConfigMap named `realtime-gateway-apisix-plugin` containing a `jwt-auth.yaml` snippet. No file in `charts/in-falcone/` or `services/gateway-config/` references this ConfigMap. APISIX's configuration in the umbrella chart does not import it.

### G10. E2E tests assume a working transport that source cannot provide.

`tests/e2e/realtime/{subscription-lifecycle,scope-revocation,reconnection,workspace-isolation,tenant-isolation,edge-cases}.test.mjs` and the WebSocket client at `tests/e2e/realtime/helpers/client.mjs` exercise a running transport. They will be skipped or fail in CI unless an external environment provides one — but the test suite's `skip` conditions and provisioner are out-of-scope here.

### G11. No reconcile loop refreshes the JWKS configmap.

`charts/realtime-gateway/values.yaml:13-14, 17` hard-codes `https://keycloak.example/...` URLs. Operators must patch values per environment. No template or operator hooks update them dynamically.

### G12. Probes hit `/healthz/{ready,live}` but the chart contains no contract for those endpoints.

`charts/realtime-gateway/templates/deployment.yaml:61-68` configures probes against `/healthz/ready` and `/healthz/live`. The B2 library has no HTTP server; the absent transport binary is presumed to implement these. If the binary exists but implements `/health` (as the audit-map suggests by analogy with other bridges), the probes will fail and the pod will restart-loop.

### G13. JWT auth realm hard-coded in the APISIX-plugin ConfigMap.

`charts/realtime-gateway/templates/configmap-apisix-plugin.yaml:11-12` writes `jwks_uri` and `realm` from `Values.apisix.jwtAuth`. Defaults point at `https://keycloak.example/...` (`values.yaml:13-14`). Same hard-coded-placeholder problem as G11.

### G14. `apps/control-plane/openapi/families/websockets.openapi.json:680-688` claims `x-downstream-adapters: ["kafka"]` but the Kafka publisher used by the realtime path is not in the control-plane source.

If the transport binary fans events out from Kafka to WS subscribers, that pipeline is also out-of-repo. The OpenAPI declares the relationship but no source enforces it.

### G15. No rate-limit / abuse-control policy is declared for `/v1/websockets/*`.

`charts/in-falcone/values.yaml:1126-1142` (route 2011) labels the route `x-rate-limit-class: realtime` via the OpenAPI side but the route's `plugins: *a3` anchor reuses the public-API plugin block. No per-route `limit-count` or `limit-req` plugin is visible in this route block; the standard public-API anchor may or may not include one. Verify against the anchor's expansion — but a WS session, once upgraded, is no longer subject to per-request rate-limiting anyway.

### G16. No connection-count quota at the gateway layer.

`MAX_SUBSCRIPTIONS_PER_WORKSPACE` (env on the deployment, `values.yaml:24`) is enforced inside the B2 library at subscription validation time. The gateway itself does not cap concurrent WS upgrades per workspace/tenant. A misbehaving client can open `MAX_SUBSCRIPTIONS_PER_WORKSPACE` connections and then exhaust file descriptors with hung TCP sockets that never reach the auth path.

### G17. Tests under `tests/e2e/realtime/` and the e2e helpers (`provisioner.mjs`, `iam.mjs`, `client.mjs`) imply an integration topology this repo cannot self-host.

The provisioner and IAM helpers would need a real Keycloak realm, a real Postgres for the B2 schema, a real Kafka cluster, and the transport binary. Running them against a stub of the transport is not modelled here.

---

## BUGS

### Confirmed (verified-by-author from cited paths)

- **B1. The transport binary's source is absent from the repo.**
  `grep -rn "ghcr.io/falcone/realtime-gateway" /home/andrea/Documents/falcone` returns only `charts/realtime-gateway/values.yaml` and `services/realtime-gateway/package.json`. There is no Dockerfile, no entrypoint, no HTTP/WS server, no SSE writer, no Kafka consumer-to-WS bridge anywhere in source. F2 is a chart for an out-of-repo binary.

- **B2. The standalone chart lacks a `Service` template.**
  Directory listing of `charts/realtime-gateway/templates/` (verified-by-author by `find`): only `configmap-apisix-plugin.yaml`, `deployment.yaml`, `secret-ref.yaml`. `values.yaml:8-9` declares `service.port: 8080`, but no template creates a `Service` matching the Deployment's pod labels. Cluster-internal traffic cannot reach the Deployment by DNS.

- **B3. The umbrella chart does not route to the standalone deployment.**
  `grep "realtime-gateway\|realtimeGateway" charts/in-falcone/values.yaml` returns no upstream `component: realtimeGateway`. The two routes that *could* be relevant (1003 `/realtime/*`, 2011 `/v1/websockets/*`) both target `component: controlPlane`. Combined with B2, the standalone Deployment is provisioned but unreachable in the cluster.

- **B4. The `realtime-gateway-secrets` Secret ships with empty `stringData`.**
  `charts/realtime-gateway/templates/secret-ref.yaml:6-9` (verified-by-author). The B2 library at `services/realtime-gateway/src/config/env.mjs:23-29` throws on empty `DATABASE_URL`, `KAFKA_BROKERS`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`. A fresh chart install crash-loops on first start.

- **B5. The capability-gated paths `/v1/workspaces/*/realtime[/*]` and `GET /v1/events/subscribe` have no APISIX route.**
  `services/gateway-config/routes/capability-gated-routes.yaml:18-22` declares the gates; `grep "v1/workspaces.*realtime" charts/in-falcone/values.yaml` and `grep "v1/events/subscribe" charts/in-falcone/values.yaml` both return zero matches. Gating policy applies to routes that aren't in the deployed table.

- **B6. `x-owning-service: event_gateway` mis-attributes the WebSocket session contract.**
  `apps/control-plane/openapi/families/websockets.openapi.json:684` (verified-by-author). F1 audit established `services/event-gateway/src/` has no HTTP server. The realtime-gateway B2 library has no HTTP server either. Whatever owns `createWebSocketSession` is not the service the contract names.

- **B7. Routes 2014/2015 use a misleading `/v1/realtime/` URL prefix for non-realtime endpoints.**
  `charts/in-falcone/values.yaml:1177, 1193` (verified-by-author). These are `mongo-captures` admin endpoints with no `enableWebsocket: true` and no realtime semantics. The naming will collide with operator/customer mental models for "realtime".

- **B8. JWKS / introspection URLs in the standalone chart point at `keycloak.example` by default.**
  `charts/realtime-gateway/values.yaml:13-14, 17-18` (verified-by-author). No overlay file changes them. An operator who installs the chart without per-environment overrides will see immediate JWT verification failures.

- **B9. The `realtime-gateway-apisix-plugin` ConfigMap is never consumed.**
  `grep -rn "realtime-gateway-apisix-plugin" /home/andrea/Documents/falcone` returns only its definition. Nothing in the umbrella's APISIX bootstrap or operator wires it.

### Likely (smells / mis-wiring / patterns that match other bridges)

- **B10. The hard-coded `KEYCLOAK_INTROSPECTION_CLIENT_ID = 'realtime-gateway'` in `values.yaml:19` is not present in the Keycloak bootstrap inventory** (B1-cap audit found Keycloak bootstrap creates only `in-falcone-gateway` and `in-falcone-console` clients in `charts/in-falcone/values.yaml:360-398`). If a `realtime-gateway` Keycloak client doesn't exist, introspection calls will 401.

- **B11. `/healthz/ready` and `/healthz/live` (the chart's probe paths) are unconventional for this codebase** — other services in this repo (pg-cdc-bridge, mongo-cdc-bridge, the F1 stub) expose `/health` and `/metrics`. The realtime-gateway image — assuming it exists — would need to implement these specific paths. If it follows the pattern of sibling bridges and exposes `/health`, the probes will 404 and pods restart-loop.

- **B12. The chart sets no resource requests/limits.** `charts/realtime-gateway/templates/deployment.yaml` (verified-by-author by full read) has no `resources:` block. The pod will run with cluster defaults — usually unlimited CPU / unlimited memory — until the node evicts it.

- **B13. `replicaCount: 1` for a stateful WS session manager (B2's session manager is in-memory).** `charts/realtime-gateway/values.yaml:6`. Pod restart drops every active subscription. Per the B2 audit (bug B12 there), there is no recovery loop that re-attaches pollers for sessions still marked ACTIVE in Postgres. Combined here: a chart restart loses state with no compensating recovery.

- **B14. Liveness + readiness use the same path.** `charts/realtime-gateway/templates/deployment.yaml:61-68`. If the realtime-gateway implements a single endpoint that returns ready-only semantics, liveness will fail during slow startup; if it returns liveness-only semantics, readiness will return 200 before the WS server is actually accepting connections.

- **B15. Route 1003 `/realtime/*` priority 80 is lower than 2011 `/v1/websockets/*` priority 229.** `charts/in-falcone/values.yaml:842, 1130`. Per APISIX, higher priority wins — so `/v1/websockets/*` is preferred over `/realtime/*` if both could match. Today's URIs don't overlap, but the priority gap is large and undocumented.

- **B16. The websockets OpenAPI declares 431 (Request Header Fields Too Large) and 413 responses with `ErrorResponse` envelopes**, but the F1 event-gateway validator (the supposed owning service) does not return these codes. The contract claims header/payload-size enforcement; the absent transport must implement it. (`websockets.openapi.json:612-641`.)

- **B17. `Idempotency-Key` is required on `POST /v1/websockets/sessions`** (`websockets.openapi.json:568`). The contract implies replay storage for 24h. No storage backend for that is in source — the schema for idempotency keys lives in provisioning-orchestrator's saga subsystem, but the realtime path doesn't reach saga.

### Needs verification

- **B18. Does `ghcr.io/falcone/realtime-gateway:latest` actually exist?** Cannot determine from this repo. The chart references it but no CI workflow under `.github/workflows/` (not opened in this audit) is known to build it. If the image is missing, `imagePullPolicy: IfNotPresent` (`values.yaml:4`) means pods Pending forever.

- **B19. Whether the in-falcone umbrella chart's installation procedure includes the standalone realtime-gateway chart.** `charts/in-falcone/Chart.yaml` was not opened for `dependencies:`. If the umbrella declares the standalone chart as a dep, route mis-targeting (B3) is still a bug. If it doesn't, the standalone chart is install-only-by-operator and the broader system has no realtime path at all.

- **B20. Whether `keycloak-config/scopes/` (audit B1) declares the scopes the B2 library expects** (audited there as a separate bug). The realtime transport, if it ever runs, would receive tokens whose scopes were never provisioned in Keycloak per B1 audit findings.

- **B21. Whether the chart's APISIX-plugin ConfigMap (`configmap-apisix-plugin.yaml`) would be picked up by the umbrella's APISIX if the latter ran with a `serviceMonitor` for ConfigMaps.** Requires reading the umbrella's APISIX subchart `Values.apisix.discoverConfigMaps` (not in scope here).

- **B22. Whether the e2e tests under `tests/e2e/realtime/` are expected to run in CI or are documentation-only.** Verify `package.json` test scripts and `.github/workflows/`. If they do run, they almost certainly skip everything except setup.

---

## Scope note for downstream spec authoring

F2 is not a working capability in this repo. It is the union of four artifacts that don't compose:

- **F2a — OpenAPI declarations** for `POST /v1/websockets/sessions` and `GET /v1/websockets/sessions/{sessionId}` (`apps/control-plane/openapi/families/websockets.openapi.json:557-…`), wrongly owning-service-tagged to `event_gateway`.
- **F2b — APISIX route table entries** in the umbrella chart that send `/realtime/*` and `/v1/websockets/*` to controlPlane (`charts/in-falcone/values.yaml:839-846, 1126-1142`), neither of which has a known handler in source.
- **F2c — Capability gating** that declares `/v1/workspaces/*/realtime*` and `/v1/events/subscribe` as gated paths (`services/gateway-config/routes/capability-gated-routes.yaml:18-22`) without any upstream definition.
- **F2d — A standalone chart** (`charts/realtime-gateway/`) that deploys an out-of-repo image, with no Service, no umbrella route pointing at it, and an empty Secret.

Before writing OpenSpec FRs:

1. **Decide whether the transport binary is in scope.** If yes, either import its source into this repo or vendor its Dockerfile/CI. The B2 library exists to be consumed by *something*; the something is what F2 is supposed to be.
2. **Resolve where `createWebSocketSession` is implemented.** Either add the implementation to `event_gateway` (consistent with the OpenAPI tag) or correct the tag to point at the actual owner.
3. **Wire the standalone chart properly:** add a `Service`, add an upstream `component: realtimeGateway` to the umbrella, and point routes 1003 / 2011 at it. Without these, F2 is dead.
4. **Reconcile the URL spaces** — `/realtime/*`, `/v1/websockets/*`, `/v1/workspaces/*/realtime*`, `/v1/events/subscribe`, and `/v1/realtime/.../mongo-captures/*` (routes 2014/2015 misnamed) — under one consistent realtime URL convention. Today they are four overlapping or misleading namespaces.
5. **Provision Keycloak scopes and a `realtime-gateway` Keycloak client** in the chart-driven bootstrap path (`charts/in-falcone/values.yaml:360-398`). Today the chart relies on a client and scopes that don't exist (cross-references B1 audit findings).
6. **Provision the Secret** via External Secrets Operator or document the operator step. The chart's current `secret-ref.yaml` is a deployment foot-gun.

The B2 library is the only sturdy artifact in this capability. Any OpenSpec proposal that treats F2 as one unit will be unmanageable; split into F2-binary (the missing server), F2-routing (the chart wiring), and F2-contract (the OpenAPI surface).
