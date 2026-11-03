# Capability grants contract

This directory holds the capability-grants contract for serverless guest code (JSON Schema 2020-12). It defines
which host capabilities a revision may be granted, and, from v1.1, how a secret may reach guest code and which
internal destinations may be reached.

No runtime component consumes these schemas yet. Enforcement belongs to the capability host and the egress
gateway, and may consume v1.1 only after ADR 0005 is accepted through R3 review.

## Files

| File | Purpose |
| --- | --- |
| `capability-grants.v1.schema.json` | v1: a non-empty array of `grant`. |
| `capability-grants.v1.1.schema.json` | v1.1: v1 plus `secret_grant` and `internal_destination_binding`. |
| `vendored-from-revision-runtime-manifest.json` | The pinned v1 `$defs` block, used by the pin test. |
| `fixtures/` | `v1-valid`, `v1-invalid`, `v1.1-valid` and `v1.1-invalid` cases. |
| `index.mjs` | The contract test, imported by `tests/contracts/capability-grants.contract.test.mjs`. |

## v1 pin

v1 is the existing grant model, vendored unchanged. Its `$defs` are copied from falcone-serverless
`docs/contracts/revision-runtime-manifest.schema.json` at commit `e6250e6038d8c193e91ef871366f5653481bd193`:
`grant` and every definition it references (`storageScope`, `httpScope`, `eventScope`, `workflowScope`,
`secretRef`, `safeName`).

The pin test compares the canonical JSON (sorted keys) of each v1 `$defs` entry, and of the same entries in v1.1,
with `vendored-from-revision-runtime-manifest.json`. Changing a vendored definition fails the test. Changing v1
means changing the pin deliberately, in a reviewed change that also updates the recorded source commit.

The source commit is not available in this repository, so a reviewer should confirm that the vendored block
matches upstream.

## v1.1

v1.1 is additive. Every item of the top-level array is exactly one of: a v1 `grant`, an object with only the key
`secret_grant`, or an object with only the key `internal_destination_binding`. Every v1 valid case is valid in
v1.1. v1 rejects the new shapes.

Default-deny: an empty or absent entry means no secret exposure and no internal destination.

### `secret_grant`

| Field | Rule |
| --- | --- |
| `secret_ref` | Required string, `minLength` 1. A reference, never a value. |
| `purpose` | Required string, `minLength` 1. |
| `exposure` | Required: `host-use` or `guest-exposed`. Guest exposure is never implicit. |
| `host_operation` | Required when `exposure` is `host-use`. |
| `review` | Required when `exposure` is `guest-exposed`: `reviewer`, `reviewed_at` and `scope`, all required. |

`reviewed_at` is a UTC timestamp (`YYYY-MM-DDThh:mm:ssZ`) checked by a pattern, so no format plugin is needed.
The schema checks only that the review fields are present. Authority comes from the R3 review, and a review
record can become a rubber stamp.

### `internal_destination_binding`

Required: `binding_id`, `host`, `port` (integer 1 to 65535) and `scheme` (`https` only).

`host` is a lowercase DNS name whose last label starts with a letter. IP literals (IPv4 and IPv6), wildcards,
CIDR ranges, paths and uppercase variants fail the pattern, and `metadata.google.internal` is rejected
explicitly. Metadata and IP-literal targets are therefore never bindable.

The schema cannot stop DNS rebinding, redirects, or internal names that resolve to forbidden addresses. That
runtime part stays with the egress gateway.

## Credential boundary

- A secret value never appears in a grant. `secret_grant` has no value field, and unknown properties are rejected.
- Credentials stay in the host binding layer unless a reviewed `guest-exposed` grant allows a narrow secret.
- Fixtures contain no real credentials.
- Resolving, fetching and rotating secret values is out of scope.

## Versioning rule

- A minor revision (`1.x`) is additive and keeps every earlier valid document valid.
- Any other change needs a new major version.
- Do not edit the vendored v1 definitions in place.

## Tests

`pnpm run test:contracts` runs the suite. It parses every `*.json` file in this directory and in `fixtures/`,
compiles both schemas, runs the pin test, and reports every fixture case as its own subtest. Each invalid case is
one valid case with one mutation, and the test asserts the keyword and location it fails on. A parse or compile
error fails the run.

## Kill switch

Revert the files in this directory and `tests/contracts/capability-grants.contract.test.mjs`. No runtime reads
these schemas.
