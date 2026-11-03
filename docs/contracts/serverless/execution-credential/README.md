# Execution credential contract v1

`ctr-execution-credential` defines claims, trusted verification context and rejection rules for short-lived,
audience-bound serverless execution credentials. This is a contract and a pure, test-only reference verifier;
no issuer, production verifier, host binding, OCI shim or registry is implemented here.

## Sources and related contracts

The rules follow these sources in **gntik-ai/falcone-serverless**, pinned to commit
`784ce45268d7c531422ea1ebd6af5e38af71da7f`:

- [ADR 0006: docs/adr/0006-pool-identity-and-openbao.md](https://github.com/gntik-ai/falcone-serverless/blob/784ce45268d7c531422ea1ebd6af5e38af71da7f/docs/adr/0006-pool-identity-and-openbao.md).
  ADR 0006 is **Proposed**. If its R3 review changes the issuer or claims, supersede v1.
- [ADR 0010: docs/adr/0010-oci-execution-mode-and-base-catalog.md](https://github.com/gntik-ai/falcone-serverless/blob/784ce45268d7c531422ea1ebd6af5e38af71da7f/docs/adr/0010-oci-execution-mode-and-base-catalog.md).
- [Design: docs/falcone-serverless-design.md](https://github.com/gntik-ai/falcone-serverless/blob/784ce45268d7c531422ea1ebd6af5e38af71da7f/docs/falcone-serverless-design.md),
  FR-SEC-05 and SEC-03 criteria 1 and 4.

This contract consumes `ctr-platform-service-identity` without redefining it. Capability grants come from
[`ctr-capability-grants` v1](../capability-grants/capability-grants.v1.schema.json), loaded by path, never copied.
It does not opt into v1.1 secret exposure or internal-destination grants.

## Files and public seam

| File | Purpose |
| --- | --- |
| `execution-credential.v1.claims.schema.json` | JSON Schema 2020-12 claims; unknown properties are forbidden at every object level, including referenced grant definitions. |
| `reference-verifier.mjs` | Pure `verify(claims, context)` returning exactly `{verdict, reason}`. |
| `fixtures/v1-valid.json` | Complete accepting claim sets and contexts. |
| `fixtures/v1-invalid.json` | Each case changes one field of the valid Wasm base and declares one rejection reason. |
| `index.mjs` | Contract suite, imported by `tests/contracts/execution-credential.contract.test.mjs`. |

Acceptance is `{verdict: "accept", reason: null}`. Rejection is `{verdict: "reject", reason: <code>}`.
The default is rejection; acceptance requires every check to pass. Unknown or malformed inputs and thrown
errors never grant access. An unexpected exception returns `malformed-claims`, without exposing its message.
The verifier never changes its inputs, reads a clock, performs network calls or mutates a registry.

## Claims

All fields are required. Strings are non-empty; timestamps are finite, non-negative Unix seconds and may be
fractional. Unknown properties, including nested grant properties, are rejected.

| Claim | Rule |
| --- | --- |
| `iss` | Exactly `falcone:admission-dispatch`, the contract identifier for Falcone admission/dispatch. |
| `aud` | One audience string, exactly the trusted context's `audience`. |
| `tenant`, `workspace` | Exactly the corresponding verified context identifiers. |
| `pool_profile` | Opaque identifier for the pinned pool/profile binding, exactly the verified value. |
| `revision`, `activation`, `attempt` | Exactly the corresponding verified identifiers. |
| `iat`, `exp` | Issued-at and expiry, checked by the lifetime rules below. |
| `allowed_capabilities` | Array of v1 grants, each referring to a family and interface and canonically equal to an element of `pinned_grants`. An empty array grants nothing. |

Grant equality sorts object keys recursively; array order remains significant. Equality includes the entire
grant, including scope and optional fields. A broader scope, matching family alone, or matching interface alone
is insufficient. The requested capability is a complete grant and must canonically equal an allowed entry.
Object-ID checks within an operation remain the host operation's responsibility.

## Trusted verification context

The caller supplies context from verified admission/dispatch and holder state, never from guest assertions.
There are no defaults for required context fields. Unknown context properties reject as `malformed-claims`.

| Field | Meaning |
| --- | --- |
| `now` | Trusted finite, non-negative Unix seconds. |
| `max_lifetime_seconds` | Required positive finite number; strings, absence, zero and negative values fail closed. |
| `attempt_deadline` | Trusted finite, non-negative Unix seconds. |
| `tenant`, `workspace`, `pool_profile`, `revision`, `activation`, `attempt` | Verified identifiers to compare to claims. |
| `audience` | Trusted expected audience string. |
| `attempt_state` | Must be `active`; completed, cancelled and unknown states reject. |
| `pinned_grants` | Revision's pinned grants, validated against the existing capability-grants v1 schema. |
| `requested_capability` | Full v1 grant required by the host operation. |
| `holder` | Exactly `wasm-host-binding` or `oci-shim`. |
| `handle_registry` | Trusted array of entries with exactly `{handle, attempt, state}`; handles are unique. |
| `presented_handle` | Opaque registry lookup token. |
| `guest_scope` | Optional object containing only optional `tenant` and `workspace`. If present, each must equal its credential claim. |

Only the Wasm host binding layer and the trusted OCI shim hold credentials. `guest`, `tenant-container` and
all other holder values reject. Signing keys and credentials never enter guest code or the tenant container.
Guest fields confer no authority: even matching fields cannot rescue a credential rejected by another check.

### Lifetime

Accept only `iat <= now < exp`, `exp <= attempt_deadline`, and
`exp - iat <= max_lifetime_seconds`. The maximum has no default. Zero clock skew and no renewal are intentional.
Thus `now == iat`, `now == exp - 1`, `exp == attempt_deadline` and lifetime equal to the maximum are allowed;
`now == exp`, `now > exp`, future `iat`, exceeding the deadline and lifetime equal to maximum plus one reject.
A missing `exp` is a schema error, not an expiry verdict.

An attempt longer than the configured maximum loses host access and fails closed. Operators must set the
maximum at or above job deadlines. Clock drift may reject otherwise valid credentials.

### Opaque handles

The syntax is a non-empty string matching `^[A-Za-z0-9_-]+$`, with neither `-----BEGIN` nor `-----END` markers.
No dots, whitespace, JWT-like dotted values, embedded JSON claims or PEM markers are permitted. Fixtures use
obvious placeholders such as `-----BEGIN TEST-----`; there are no real secrets, keys or credentials.

Syntax alone never proves validity. A handle carries no claims, keys or secrets. The holder's trusted registry
must resolve it to the current attempt with entry `state: "active"`. Other permitted registry states are
`completed`, `cancelled` and `expired`; all three reject as `handle-not-bound-to-attempt`. An unknown token
rejects as `unknown-handle`. Malformed entries or duplicate registry handles reject as `malformed-handle`.
Registry state models expiry; this test model does not generate handles or track their lifecycle.

The context's attempt state and the registry entry's state are distinct observations. A completed or cancelled
context fails at the attempt-state check. An expired credential fails at the lifetime check. To exercise the
later handle check, fixtures keep the context active and the credential valid while the registry entry is
completed, cancelled or expired, or refers to another attempt. The first failing check always wins.

## Verification order

The verifier applies these checks in this fixed order and returns immediately at the first failure:

1. Maximum lifetime configuration.
2. Claims schema, finite claim times and unknown context properties.
3. Trusted holder.
4. Issuer.
5. Audience.
6. Lifetime, including valid context times and the attempt deadline.
7. Tenant.
8. Workspace.
9. Other scope identifiers: pool/profile, revision, activation and attempt.
10. Active attempt state.
11. Pinned grants schema and allowed capabilities subset.
12. Requested capability membership.
13. Guest scope.
14. Handle syntax, registry shape, lookup and active attempt binding.

## Rejection reason codes

These sixteen kebab-case codes are stable in v1. A fixture has exactly one expected reason.

| Code | First failing condition |
| --- | --- |
| `invalid-lifetime-config` | Maximum absent, non-number, non-finite, zero or negative. |
| `malformed-claims` | Claims schema violation, non-finite claim times, unknown context property, or unexpected exception. |
| `untrusted-holder` | Holder is neither the Wasm host binding nor the OCI shim. |
| `wrong-issuer` | Issuer differs from Falcone admission/dispatch. |
| `wrong-audience` | Audience differs from the trusted expected audience. |
| `expired-or-overlong` | Time window, deadline, maximum duration or context time is invalid. |
| `tenant-mismatch` | Credential tenant differs from verified tenant. |
| `workspace-mismatch` | Credential workspace differs from verified workspace. |
| `scope-mismatch` | Attempt, activation, revision or pool/profile differs. |
| `attempt-not-active` | Context attempt is not active. |
| `capabilities-outside-grants` | Pinned grants are malformed or an allowed capability is not a canonical member. |
| `requested-capability-not-allowed` | Requested capability is not a canonical member of the credential's allowed capabilities. |
| `guest-scope-mismatch` | Guest scope is malformed or a supplied tenant or workspace differs. |
| `malformed-handle` | Presented token or registry fails the opaque syntax or registry shape rules. |
| `unknown-handle` | Well-formed token has no registry entry. |
| `handle-not-bound-to-attempt` | Entry belongs to another attempt or is no longer active. |

## Tests

`pnpm run test:contracts` discovers the thin entry and reports every fixture as a separate subtest. Tests compare
literal expected verdicts and reasons, reject undeclared codes, require all sixteen reasons to have a rejecting
fixture, and require the contracted fixture names. Removing any required fixture fails the coverage check.
The suite loads the existing capability-grants schema by path and validates every fixture's `pinned_grants`. It also checks canonical
membership, fixed rejection order, non-finite JavaScript inputs, thrown errors and matching guest scope.

`pnpm run lint` includes repository validation, markdownlint and OpenAPI validation. Local mutation checks remove
a rejecting fixture and flip the expiry comparison, confirm failure, then restore the original files.

## Versioning and kill switch

v1 is immutable. Changes ship as new versions; consumers pin an explicit version. R3 requires an independent
second reviewer and explicit operator approval before merge. ADR 0006's Proposed status cannot authorize
changing a pinned v1 in place.

Before any consumer pins v1, revert the contract commit, including the thin test entry. After pinning, mark v1
withdrawn and publish a superseding version; a withdrawn version never permits access. No deployment rollback
is needed, and no runtime or Helm changes are included.

Token format, signing algorithm, replay protection, rotation, revocation, renewal, clock-skew tolerance, handle
entropy, audit events, egress, secret-exposure grants, per-capability object-ID checks, OpenBao delivery and
channel mTLS remain outside this contract.
