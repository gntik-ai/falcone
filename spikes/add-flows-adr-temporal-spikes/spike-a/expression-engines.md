# EPHEMERAL SPIKE — not production code

## Spike A — Expression engine comparison (CEL vs JSONata)

Both engines were imported **inside the Temporal workflow module** (`workflows.mjs`), bundled by
the SDK's webpack-based `bundleWorkflowCode`, and executed inside the deterministic V8 isolate
via probe workflows (`celProbe`, `jsonataProbe`). Raw result:
`spike-a/evidence/sandbox-check.json`.

### Sandbox survival (the gate)

| Engine | Bundled into workflow isolate | Evaluated `amount > 100` (amount=250) | Survived sandbox |
|---|---|---|---|
| `cel-js@0.5.0` | yes | `true` | **yes** |
| `jsonata@2.2.1` | yes | `true` | **yes** |

Both engines are pure JavaScript (no WASM, no Node built-ins, no timers, no I/O) and therefore
both pass the Temporal V8 sandbox restrictions. Neither triggered a non-determinism or
restricted-API error. This is the decisive finding: **the sandbox does not eliminate either
candidate.**

### Measured bundle-size impact (actual, not estimated)

Each engine was bundled alone into a one-export workflow module and compared against an
SDK-only baseline. These numbers SUPERSEDE the rough estimates in `design.md` (D4), which had
the ordering backwards.

| Bundle | Bytes | Δ over SDK baseline |
|---|---|---|
| SDK-only baseline (`noop` workflow) | 1,417,706 | — |
| + `cel-js` only | 3,696,925 | **+2,279,219 (~2.17 MB)** |
| + `jsonata` only | 2,190,040 | **+772,334 (~0.74 MB)** |

`cel-js@0.5.0` ships an ANTLR4 parser runtime, which dominates its bundle delta and makes it
roughly **3× heavier in the workflow isolate** than JSONata. (The design.md estimate of "cel-js
~180 kB / jsonata ~120 kB minified" reflected published npm tarball sizes, not the bundled
in-isolate cost — the spike corrects this.)

### Determinism

| Axis | `cel-js` | `jsonata` |
|---|---|---|
| Evaluation purity | Stateless, synchronous, no I/O | Stateless; `evaluate()` returns a Promise but performs no I/O for pure expressions |
| Replay safety | Deterministic — proven by the SDK replayer (`run-replay.mjs`) | Deterministic for pure expressions; the async API is awaited inside the workflow |
| Custom functions | None needed for boolean conditions | Extension functions must be registered explicitly (a non-determinism surface if misused) |

### Embedding ease (Node 22/26 ESM)

| Axis | `cel-js` | `jsonata` |
|---|---|---|
| Import shape | named `{ evaluate }`, returns value synchronously | default import, returns a compiled expression with an async `.evaluate()` |
| Semantic fit for branch conditions | Purpose-built for **typed boolean policy/condition** expressions (Google CEL spec) | A query/transform language; booleans are a by-product of its data-navigation grammar |
| Surface area exposed to flow authors | Small, condition-oriented | Large transform language (more power than a branch condition needs) |

## Decision

**Chosen engine: `cel-js` (CEL — Common Expression Language).**

Rationale, grounded in the spike evidence:

1. **Sandbox-safe — proven, not assumed.** Both engines survive the Temporal V8 isolate
   (`sandbox-check.json`), so survival is not the differentiator.
2. **Semantic fit is the differentiator.** Flow branch conditions are exactly the use case CEL
   was designed for: side-effect-free, typed boolean predicates over a context object. JSONata
   is a full query/transform language; using it for a boolean branch exposes far more grammar
   (and more non-determinism surface via extension functions) than a condition DSL needs.
3. **Bundle cost is a one-time worker-image cost.** CEL's ~2.17 MB bundle delta (vs JSONata's
   ~0.74 MB) lands once in the interpreter worker image, not on any hot path. The added image
   weight is an acceptable trade for a narrower, condition-oriented expression surface. This
   trade-off is recorded explicitly so the production interpreter change
   (`add-flows-dsl-interpreter-worker`) can revisit it if image size becomes a constraint —
   at which point JSONata is a drop-in, sandbox-proven fallback.

Exactly one engine is chosen: **CEL (`cel-js`)**. JSONata is recorded as the validated fallback.
