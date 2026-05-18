## Why

The webhook engine has three concurrent security defects that together
let an unprivileged caller probe internal networks and decrypt every
signing secret in the database. From
`openspec/audit/cap-f3-webhook-engine.md`:

- **B1** (`services/webhook-engine/src/webhook-subscription.mjs:9-17`) —
  `isPrivateHostname` returns `false` immediately when `net.isIP(host)`
  is `false`. A hostname like `internal.example.com` resolving to
  `192.168.1.1`, or `metadata.google.internal` → `169.254.169.254`,
  passes validation. The delivery worker then POSTs to the private
  address. Classic SSRF.
- **B2** (`services/webhook-engine/actions/webhook-management.mjs:43`
  and `:141`) — `env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key'`.
  This is the master AES-256-GCM key for every webhook signing secret
  in the DB. If the env var is absent in production, every
  `webhook_signing_secrets` row is decryptable from a leaked dump.
- **B15** (`services/webhook-engine/actions/webhook-delivery-worker.mjs:7`)
  — `http = fetch`. Node's `fetch` honours `HTTPS_PROXY`. An attacker
  with control of the worker's env redirects outbound webhooks through
  an attacker-chosen proxy.
- **G1** (cross-cutting), **G7** (no allow-list of TLD/port), **G10**
  (DNS-resolution gap), **G19** (no startup guard on the default key).

## What Changes

- Pre-resolve target hostnames at validation time AND at delivery
  time; reject any host whose resolved IPs include a private/reserved
  range; on delivery, refuse if the resolved IPs at POST time differ
  from the validated set (TOCTOU-resistant).
- Remove the `'development-signing-key'` fallback. The handler MUST
  read `WEBHOOK_SIGNING_KEY` from env and crash the process at boot if
  it is missing, empty, or equal to the legacy literal.
- Replace the bare `fetch` default in the delivery worker with an
  `undici` Agent constructed with explicit `proxy: undefined,
  connect: { lookup: pinnedLookup }`; the agent MUST ignore the
  ambient `HTTPS_PROXY` / `HTTP_PROXY` environment variables.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: webhook subscription validation and delivery
  reject SSRF vectors; signing-secret encryption gains a boot-time
  guard; outbound HTTP is proxy-isolated.

## Impact

- **Affected code**:
  `services/webhook-engine/src/webhook-subscription.mjs`,
  `services/webhook-engine/actions/webhook-management.mjs`,
  `services/webhook-engine/actions/webhook-delivery-worker.mjs`,
  `services/webhook-engine/package.json` (add `undici` dep).
- **Migration**: secrets encrypted with `'development-signing-key'`
  must be re-encrypted; provide a one-shot migration script behind
  `WEBHOOK_REKEY_FROM_DEVELOPMENT_KEY=true`.
- **Breaking changes**: tenants whose `targetUrl` resolves to private
  IPs will be rejected on create AND on the next delivery; document in
  PR. Workers that relied on the ambient proxy env will need an
  explicit `WEBHOOK_OUTBOUND_PROXY` setting.
- **Out of scope**: rate-limit / tenant-isolation fixes
  (`fix-f3-rate-limit-and-tenant-isolation`), signature/payload-spill
  fixes (`fix-f3-signing-and-payload-truncation`).
