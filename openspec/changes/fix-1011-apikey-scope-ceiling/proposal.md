# Enforce workspace API key scope ceilings

## Why

Issue #1011: caller-supplied scopes replace the declared key-type ceiling, allowing an operator to mint a browser-shippable anon credential with write or DDL access. Mongo has no RLS backstop; its tenant isolation comes from the adapter predicate.

## What changes

- Keep validation in `apps/control-plane-executor/src/runtime/api-keys.mjs`, shared by HTTP issuance, the official MCP `issue_api_key` tool and rotation.
- Reject scopes outside `SCOPES_BY_TYPE[keyType]`, unknown strings, non-string entries and non-array inputs with `400 SCOPE_EXCEEDS_KEY_TYPE` before key generation or any issuance query. Errors identify only offending scope names; malformed values are not echoed.
- Preserve omitted/empty scope defaults: anon gets `data:read`; service gets `data:read`, `data:write` and `ddl:write`. Explicit service subsets remain valid. Exported key types, roles and scope ceilings stay unchanged.
- Preserve compliant rotation's type and scopes. Reject legacy over-scoped anon rows before revocation or issuance, leaving the old key active for operator action.
- Document the read ceiling on every backend, PostgreSQL RLS and Mongo's adapter predicate. Add store, HTTP and MCP regression coverage using recording pools and an in-memory network transport.

## Release note and compatibility

Anon minting with write or DDL scopes now returns `400 SCOPE_EXCEEDS_KEY_TYPE` instead of issuing a key. Clients relying on that behavior must use server-side service credentials. Existing stored keys remain valid until revoked; this change neither clamps runtime verification nor bulk-rewrites keys. Operators must revoke legacy over-scoped anon keys rather than rotate them.

## Scope and verification

No database migration, route scope-gate change, OpenAPI publication, new dependency, workflow pin or deployment-repository change is required. No cluster or credentials are used.

Tests exercise the public `issueKey` and `rotateKey` store methods against a recording pool, and POST requests through Node's HTTP parser and the real executor server. The MCP regression traverses the real JSON-RPC route and official tool dispatch; only the loopback fetch/network boundary is replaced with the same HTTP transport. Socket-based existing regressions and live PostgreSQL checks remain PR CI / integration handoff items where the sandbox cannot run them.
