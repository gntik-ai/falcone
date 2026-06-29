## Why

The entire Flows feature (visual designer #363 + run monitoring #366) is unreachable in the web
console for **every tenant on every plan**. All four flows pages gate their content on a capability
key `workflows`, and the Functions publish wizard gates on `functions_public` — but **neither key
exists** in the platform boolean-capability catalog. The catalog is seeded by exactly two
provisioning-orchestrator migrations:

- `104-plan-boolean-capabilities.sql`: `sql_admin_api, passthrough_admin, realtime, webhooks,
  public_functions, custom_domains, scheduled_functions`
- `114-backup-scope-deployment-profiles.sql`: `backup_scope_access`

The effective-capabilities endpoint (`GET /v1/tenant/effective-capabilities`,
`services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs`) builds its
`capabilities` map by iterating ONLY over the active catalog rows, so a key absent from the catalog is
structurally always `undefined`. `useCapabilityGate`
(`apps/web-console/src/lib/hooks/use-capability-gate.ts:18`) is **fail-closed** — it returns `enabled`
only when `capabilities[key] === true`, otherwise `{ enabled:false, reason:'plan_restriction' }`. So:

- `capabilities["workflows"]` is always `undefined` → all four Flows pages render permanently inside
  `CapabilityGate mode="disable"`'s `<div class="opacity-50 pointer-events-none"
  data-testid="capability-gate-disabled">` with an "upgrade your plan" badge, for every tenant.
- `capabilities["functions_public"]` is always `undefined` (the catalog key is `public_functions`) →
  the Functions publish wizard is permanently dimmed too.

The backend Flows API itself is **not plan-gated**: there is no `/v1/flows/...` entry in the gateway
capability-gated route map (`services/gateway-config/routes/capability-gated-routes.yaml`) nor any
`planCapabilityAnyOf` block for flows in `services/gateway-config/base/public-api-routing.yaml`, and
`workflows` does not appear as a capability key anywhere in the backend. Create/get/patch/validate/
publish/delete all succeed with a valid Bearer token regardless of plan. So the correct fix is
asymmetric:

- **Flows**: the gate is spurious (no real catalog key, no backend plan-gate) → **un-gate** the four
  pages.
- **Functions**: the gate is correct but the key is a typo → **rename** `functions_public` →
  `public_functions` (the real "Public Serverless Functions" catalog key); keep the gate.

Independently reproduced 2× by a separate verifier on the running kind build. Persona P16 (web
console) / P22 (functions & workflows).

## What Changes

- **`apps/web-console/src/lib/capabilities/catalog-keys.ts`** (new) — single source of truth
  `BOOLEAN_CAPABILITY_KEYS` (the 8 catalog keys, commented to migrations 104 + 114), the
  `BooleanCapabilityKey` union type, and `isBooleanCapabilityKey`.
- **`apps/web-console/src/components/console/CapabilityGate.tsx`** — type the `capability` prop as
  `BooleanCapabilityKey` (compile-time guard against phantom keys).
- **`apps/web-console/src/lib/hooks/use-capability-gate.ts`** — type the `capabilityKey` param as
  `BooleanCapabilityKey`.
- **`apps/web-console/src/pages/{ConsoleFlowsPage,ConsoleFlowDesignerPage,ConsoleFlowHistoryPage,ConsoleFlowRunPage}.tsx`**
  — remove the `CapabilityGate capability="workflows" mode="disable"` wrapper (render the page content
  directly) and drop the now-unused `CapabilityGate` import. No other page behavior changes (the
  broader Flows UX is owned by #793/#791/#792).
- **`apps/web-console/src/pages/ConsoleFunctionsPage.tsx`** — `capability="functions_public"` →
  `capability="public_functions"`; keep the gate (it correctly plan-gates the publish wizard).
- **`apps/web-console/src/pages/ConsoleFunctionsPage.test.tsx`** — update the mocked context
  `capabilities` from `{ functions_public: true }` → `{ public_functions: true }` so the existing
  publish-wizard tests keep passing after the rename.
- **`apps/web-console/src/lib/hooks/use-capability-gate.test.ts`** — cast the deliberate unknown-key
  negative test through `BooleanCapabilityKey` (its intent is the runtime deny-by-default path).
- **`apps/web-console/src/pages/ConsoleFlowsPage.test.tsx`** (new) — Scenario 1 regression test: renders
  `ConsoleFlowsPage` with the REAL (non-mocked) capability gate and a capabilities map WITHOUT a
  `workflows` key, asserting the page is interactive (no `capability-gate-disabled`, "New flow"
  affordance + name input present).
- **`apps/web-console/src/lib/capabilities/capability-gate-keys.test.ts`** (new) — Scenario 2 audit
  guard: scans `apps/web-console/src` for every `CapabilityGate capability="X"` /
  `useCapabilityGate('X')` literal and asserts each `X` is in `BOOLEAN_CAPABILITY_KEYS`.
- **No contract artifacts changed**: no `*.openapi.json`, no generated SDK/types, no
  `internal-contracts`, no route catalogs. The gate is a pure client concern; this is frontend-only.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement — console features must be gated only on capability keys present
  in the platform boolean-capability catalog (so the gate is satisfiable). This is a new requirement
  under `web-console` (no existing requirement in `openspec/specs/web-console/spec.md` covers
  capability gating), so it is added as `## ADDED Requirements` rather than MODIFIED.
