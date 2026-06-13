# Environment Variables

The runnable control-plane / executor service (`apps/control-plane/src/runtime`) is configured by environment variables. In a chart deployment these are populated from the component config + `secretRefs`; for local runs you set them directly.

## HTTP

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `CONTROL_PLANE_UPSTREAM` | — | Upstream for paths the executor proxies (pinned for SSRF safety) |

## PostgreSQL (data + control DB)

The Postgres DSN is built from discrete vars, or supplied whole:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DB_URL` / `DB_URL` | — | Full DSN (takes precedence over the discrete vars) |
| `PGHOST` | `localhost` | Host |
| `PGPORT` | `5432` | Port |
| `PGUSER` | `falcone_app` | **Non-`BYPASSRLS`** application role |
| `PGPASSWORD` | — | Password |
| `PGDATABASE` | `falcone` | Database |
| `CONTROL_DB_URL` | falls back to the data DSN | Pool for API-key storage |

> [!IMPORTANT]
> `PGUSER` must be a **non-`BYPASSRLS`** role (default `falcone_app`). RLS does not apply to superusers, so connecting as one would silently disable tenant isolation.

## MongoDB

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URI` | — | Full URI (takes precedence) |
| `MONGO_HOST` | — | Host (used to build the URI) |
| `MONGO_USER` / `MONGO_PASSWORD` | — | Credentials |
| `MONGO_AUTH_SOURCE` | `admin` | Auth source when a user is set |

For change streams / realtime the URI must point at a **replica set** (e.g. `?replicaSet=rs0`).

## Events & functions

| Variable | Default | Purpose |
| --- | --- | --- |
| `KAFKA_BROKERS` | — | Comma-separated brokers; events executor is enabled only when set |
| `FN_BACKEND` | — | Set to `off` to disable the functions executor |

## Flows (Temporal) *(Preview)*

The Flows API is registered **only when `TEMPORAL_ADDRESS` is set** (the executor is the sole Temporal client).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | — | Temporal frontend `host:port`; **enables Flows** when set |
| `TEMPORAL_NAMESPACE` | `falcone-flows` | Shared Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `flows-main` | Worker task queue |
| `FLOW_QUOTA_ENFORCE_URL` | — | Quota-evaluator endpoint; when set, hard-limit breaches → `429` |
| `FLOW_AUDIT_TOPIC` | `falcone.audit.flow-lifecycle` | Kafka topic for flow lifecycle audit (best-effort) |
| `FLOW_TRIGGER_SECRET_KEY` | — | Master key for per-trigger webhook signing secrets |
| `FLOWS_ENABLED` | — | Set to `false` to keep the Flows API but suppress the monitoring SSE endpoint |

## MCP server hosting *(Preview)*

The MCP management API (`/v1/mcp`) is registered **only when `MCP_ENABLED=true`**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_ENABLED` | — | Set to `true` to serve the MCP management API |
| `MCP_SELF_BASE_URL` | `http://127.0.0.1:$PORT` | Base URL the engine self-calls to mediate tool calls |
| `MCP_GATEWAY_BASE_URL` | (self URL) | Public base URL used to compute a server's endpoint |
| `MCP_RUNTIME_IMAGE` | — | Platform MCP runtime image (digest-pinned for the registry) |
| `MCP_RUNTIME_IMAGE_DIGEST` | — | `sha256:` digest of the runtime image |

## Identity (JWT verification)

| Variable | Purpose |
| --- | --- |
| `KEYCLOAK_JWKS_URL` | JWKS endpoint to fetch signing keys |
| `KEYCLOAK_ISSUER` | Expected token issuer |
| `KEYCLOAK_AUDIENCE` | Expected token audience |

When these are set, Bearer JWTs are verified locally and their claims become the identity (precedence #2). When unset, the service trusts gateway-injected identity headers (precedence #3).

## Where values come from in a chart install

`values.yaml → config.secretRefs` maps existing Kubernetes Secrets to the credentials above:

| `secretRefs` entry | Keys | Feeds |
| --- | --- | --- |
| `postgresCredentials` | `username`, `password`, `database` | `PG*` |
| `mongoCredentials` | `username`, `password`, `database` | `MONGO_*` |
| `kafkaCredentials` | `username`, `password` | Kafka |
| `objectStorageCredentials` | `access-key`, `secret-key` | Storage |
| `identityClient` | `client-id`, `client-secret` | Keycloak client |
| `gatewayTls` | `tls.crt`, `tls.key` | Gateway TLS |

See [Secret Management](/operations/secret-management).
