# Tasks — fix-mcp-tool-call-execution

## Reproduce (test-first)
- [x] Add a failing black-box probe that reproduces: a published instant/official MCP tool-call self-calls a path that matches no route → hits the executor root `/` → returns the index JSON `{"service":"in-falcone-control-plane"}` instead of tool data. (`tests/blackbox/mcp-tool-call-execution.test.mjs`, bbx-mcp-call-01..08; verified failing against the unfixed engine/generator/registry.)

## Implement (kind runtime AND shippable product)
- [x] Persist the tool's routing metadata (method/path/source) in the registry — `mcp-registry.mjs` `toolContract` dropped them, so every published tool-call lost its route and fell through to the executor index (deepest root cause).
- [x] Fix the instant tool request templates — `mcp-instant-generator.mjs`: postgres `…/tables/{t}/rows`; functions `…/actions/{name}/invocations`; storage `/v1/storage/buckets/{bucketId}/objects/{objectKey}`; events `…/topics/{topic}/(publish|messages)`.
- [x] Route official/platform tools to the control-plane and fill the real route params (table/db/schema/topic/object-key/function-name from source+args; workspace/tenant from the credential context, NEVER args) with the correct method/body — `mcp-engine.mjs` `invokeTool`/`resolveCall`.
- [x] Set `MCP_SELF_BASE_URL` in the executor deploy env — `deploy/kind/executor-demo.yaml` and the live-campaign runtime patch `tests/live-campaign/advanced-caps.sh` (alongside `MCP_ENABLED`). `main.mjs` already defaults it to `http://127.0.0.1:${PORT}`. No other deploy field changed.
- [x] Update the generator path assertions that encoded the wrong paths — `mcp-instant-generator.test.mjs`.

## Verify
- [x] Black-box suite green (`bash tests/blackbox/run.sh` → 808 pass / 0 fail); colocated MCP tests green (69 pass / 0 fail). The reproduction probe now passes (self-call reaches the real executor route).
- [x] Acceptance: A hosted tool-call performs the real action and returns its result (not the executor index).

## Archive
- [x] `openspec validate fix-mcp-tool-call-execution --strict`.
- [ ] `/opsx:archive fix-mcp-tool-call-execution` after merge. (Deferred — orchestrator batches archiving.)
