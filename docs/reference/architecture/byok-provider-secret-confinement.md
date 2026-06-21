# BYOK provider secret confinement and endpoint SSRF policy

Falcone lets a workspace bring its own LLM and embedding provider (BYOK — *bring your own key*):
each workspace configures a provider `endpoint`, an allow-list of models, and a `secretRef` that
points at the provider API key. The plaintext key is **never** persisted — only the `secretRef` is
stored, and the key value is resolved fresh at request time so key rotation is picked up
immediately.

Because the resolved key is sent as `Authorization: Bearer <value>` to the configured endpoint, two
properties are enforced as a single fail-closed chokepoint
(`apps/control-plane/src/runtime/byok-provider-guard.mjs`), shared by the LLM executor, the embedding
executor, and the workflow worker's `llm.complete` activity:

1. **Secret confinement** — the key is resolvable only from a secret whose env-var name carries an
   operator-controlled reserved prefix (default `BYOK_`). A caller can never name an unrelated
   platform secret.
2. **Endpoint SSRF guard** — the provider endpoint is validated against the shared SSRF blocklist; an
   internal/loopback/link-local/metadata/private target is rejected.

## Endpoints

These routes are workspace-scoped and require a tenant owner/admin (or superadmin) caller. The
verified identity's `tenantId` is injected server-side, so a provider row is keyed by
`(tenant_id, workspace_id)` and never trusts a `tenantId` in the request body.

| Method | Path | Purpose |
| --- | --- | --- |
| PUT | `/v1/workspaces/{workspaceId}/llm-provider` | Configure the BYOK LLM provider. |
| PUT | `/v1/workspaces/{workspaceId}/embedding-provider` | Configure the BYOK embedding provider. |
| POST | `/v1/workspaces/{workspaceId}/llm/completions` | Run an LLM completion (resolves the key, dials the endpoint). |

A provider config body carries `providerType`, `endpoint`, `allowedModels` / `model`, and a
`secretRef`. The env-var form is `secretRef: { "name": "BYOK_..." }`.

## Secret confinement (reserved env-var prefix)

A BYOK key is provisioned out of band (e.g. ESO/Vault mounts it into the executor as an environment
variable) and referenced by name. The resolver reads **only** an environment variable whose name is
on the reserved-prefix allow-list:

- `BYOK_SECRET_ALLOWED_PREFIXES` — comma-separated list of allowed env-var name prefixes. Empty
  entries are ignored; when the list is empty it falls back to the default **`BYOK_`**. An empty
  prefix is never honoured (it would match every variable).
- A `secretRef.name` must be a valid env identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) **and** start with
  one of the allowed prefixes.

Behaviour:

- **Config time** — a `PUT …/llm-provider` or `…/embedding-provider` whose `secretRef.name` is not
  allow-listed is rejected with **HTTP 400 `BYOK_SECRET_REF_NOT_ALLOWED`** and **no row is
  persisted**.
- **Request time** — the name is re-checked before the key is resolved. A provider row that
  predates this guard (a name like `PGPASSWORD`, `HOSTNAME`, `GATEWAY_SHARED_SECRET`,
  `MONGO_PASSWORD`, `FERRETDB_TENANT_URI__*`) resolves to **null**: the variable is **never read**
  from `process.env`, and the completion/embedding fails closed
  (`LLM_PROVIDER_SECRET_UNRESOLVED` / `EMBEDDING_SECRET_UNRESOLVED`).

To onboard a BYOK key, mount it under a `BYOK_`-prefixed env var (e.g. `BYOK_OPENAI_KEY`) and set
`secretRef: { "name": "BYOK_OPENAI_KEY" }`.

> A `secretRef` with no `name` (e.g. a `{ "vaultPath": "…" }` form handled by a different resolver)
> is not an env-var lookup and is left to that resolver's own fail-closed handling.

## Endpoint SSRF policy

The provider `endpoint` is validated both at config time (reject **HTTP 400
`BYOK_ENDPOINT_BLOCKED`**, no row persisted) and again immediately before the outbound request
(DNS-rebinding defense; a pre-existing malicious row fails closed and **no request is sent**). The
guard reuses the shared blocklist `isBlockedIp`
(`services/webhook-engine/src/webhook-subscription.mjs`).

Rejected:

- non-`http(s)` schemes and malformed URLs;
- `localhost`;
- IP literals — including numeric/decimal/hex/octal encodings (e.g. `2852039166` →
  `169.254.169.254`) — in any blocked range: loopback `127.0.0.0/8`, RFC 1918 private, link-local
  `169.254.0.0/16` and `fe80::/10`, ULA `fc00::/7`, IPv4-mapped IPv6, NAT64 `64:ff9b::/96`, CGNAT
  `100.64.0.0/10`, benchmarking `198.18.0.0/15`, and cloud metadata `169.254.169.254`;
- DNS hostnames that resolve to **any** blocked address (every resolved A/AAAA record is screened);
- unresolvable hosts (fail closed).

Optional operator allow-list:

- `BYOK_ENDPOINT_ALLOWED_HOSTS` — comma-separated host suffixes. When set, the endpoint host must
  match one suffix (exact or `*.suffix`) **in addition to** passing the blocklist. For example,
  `BYOK_ENDPOINT_ALLOWED_HOSTS=openai.com,api.anthropic.com` restricts BYOK endpoints to those
  providers.

## Configuration summary

| Env var | Default | Effect |
| --- | --- | --- |
| `BYOK_SECRET_ALLOWED_PREFIXES` | `BYOK_` | Reserved env-var name prefixes a `secretRef.name` may use. |
| `BYOK_ENDPOINT_ALLOWED_HOSTS` | *(unset)* | If set, restricts the endpoint host to these suffixes (blocklist still applies). |

Error codes: `BYOK_SECRET_REF_NOT_ALLOWED` (400), `BYOK_ENDPOINT_BLOCKED` (400).
