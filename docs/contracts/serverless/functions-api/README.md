# Functions API contract v1

`openapi.v1.yaml` is the frozen Functions API contract, version `1.0.0` (OpenAPI 3.1). It is derived from
Falcone's own source-defined Functions family contract,
`apps/control-plane-executor/openapi/families/functions.openapi.json`, which is the route-level inventory
for this contract. Every path, method, API version, parameter, schema, response, security requirement,
pagination rule and idempotency rule in that file is preserved unchanged. The contract only adds optional
fields; nothing is removed, narrowed or widened.

No runtime component consumes this contract yet. The facade and CLI tasks pin major version 1 when they do.

## What v1 adds

| Where | Addition |
| --- | --- |
| `FunctionExecutionConfiguration`, `FunctionActionExecutionConfiguration`, `FunctionDefinitionPayload` | Optional `runtimeMode`: `wasm` or `oci`, default `wasm`. `runtime` keeps its type and enum. |
| The same three schemas | Optional `base`: a `oneOf` discriminated on `kind`. |
| `FunctionProvisioningState` | Optional `runtimeMode` (`wasm` or `oci`) and optional `failureReason`. `FunctionLifecycleState` is unchanged. |

### `base`

- `kind: catalog` requires `kind`, `id` and `digest`. `id` is `name@version`: a lowercase DNS-label name, `@`,
  then a SemVer 2.0 version without build metadata. `digest` is `sha256:` followed by 64 hex characters.
- `kind: byo` requires `kind`, `image_digest`, `signer_identity` and `attestation_ref`.
- Omitting `base` selects the per-mode, per-language default alias. It targets an enabled base and is
  resolved and pinned at deploy. `default` is not a `kind` value.

### Errors

The three new errors use the existing `ErrorResponse` envelope. `ErrorResponse.code` keeps its pattern
`^GW_[A-Z0-9_]+$` and has no enum. The reason is carried in `detail.reason`, and `retryable` is `false`.

| `code` | `detail.reason` | `retryable` |
| --- | --- | --- |
| `GW_OCI_NOT_AUTHORIZED` | `oci_not_authorized` | `false` |
| `GW_BASE_DISABLED` | `base_disabled` | `false` |
| `GW_BASE_MISMATCH` | `base_mismatch` | `false` |

`FunctionProvisioningState.failureReason` uses the same lowercase names (`oci_not_authorized`,
`base_disabled`, `base_mismatch`) and is marked `x-extensible-enum: true`. It is the only extensible enum in
the contract.

## Versioning rule

- A minor revision (`1.x.y`) is backward compatible. It may add optional fields, or add values to an enum
  marked `x-extensible-enum: true`. Clients treat a value they do not know in such an enum as a generic,
  non-retryable failure.
- Any other change needs a new major version. This includes new `runtimeMode` values, new `base.kind` values,
  and any narrowing or widening of an existing property.
- `info.version` must be semver with major exactly `1`.

## `oci` is defined, not enabled

Defining `runtimeMode: oci` in v1 does not enable it. The facade refuses `oci` with `GW_OCI_NOT_AUTHORIZED`
(`detail.reason: oci_not_authorized`) until all of these exist:

- OCI authorization (OCI-01);
- OCI base validation, including BYO validation (OCI-02);
- OCI isolation evidence (OCI-07);
- a preflight that confirms NetworkPolicy enforcement in the target cluster.

## Out of scope for v1

- Facade and CLI implementation (API-01.t2, API-01.t3).
- Async `202` and activation-ID semantics (INV-01).
- Lifecycle states and console status (API-03).
- OCI authorization, BYO validation, catalog visibility and lifecycle (OCI-01, OCI-02, CAT-04, CAT-05), and
  further base error reasons.
- Surfaces the family file does not define. The contract creates no routes for them.
- Raw Knative APIs and URLs.

## Parity tests

`pnpm run test:contracts` runs `tests/contracts/functions-api.contract.test.mjs`, which loads the suite in
`tests/contracts/functions-api/`. The suite compares this contract with the inventory keyword by keyword,
including any keyword placed beside a `$ref`. The only allowed differences are the optional properties
listed above. A later edit to the family file therefore fails the suite until v1 is regenerated or revised.
The single inventory path constant is `INVENTORY_PATH` in `tests/contracts/functions-api/support.mjs`.

## Sources

- ADR 0010, `docs/adr/0010-oci-execution-mode-and-base-catalog.md`, in `gntik-ai/falcone-serverless` at
  `784ce45268d7c531422ea1ebd6af5e38af71da7f`.
- Design document, `docs/falcone-serverless-design.md`, in `gntik-ai/falcone-serverless` at
  `784ce45268d7c531422ea1ebd6af5e38af71da7f`.
