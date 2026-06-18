# Tasks — add-mcp-workflow-and-platform-binding

## Reproduce (test-first)
- [x] Add a failing black-box probe that reproduces: no engine path turns a published flow into an MCP tool, and platform MCP tool-calls return the executor index. (`tests/blackbox/mcp-workflow-platform-binding.test.mjs`, bbx-mcp-flow-01..03 + bbx-mcp-platform-01..03; verified failing against the unfixed engine/generator.)

## Implement (kind runtime AND shippable product)
- [x] Wire the flow-backed tool generator into the MCP engine — `mcp-instant-generator.mjs` `generateFromFlows` (reuses the reviewed `flowToMcpTool` mapper) is registered in `GENERATORS`, so a workspace's published flows become long-running `run_flow_<flow>` MCP tools (`source.type === 'flow'`).
- [x] Drive the flows executor route from a tool-call — `mcp-engine.mjs` `resolveCall` flow branch builds `POST …/flows/{flowId}/executions` with body `{input}` (workspace from the credential context, NEVER args), mirroring `buildStartExecutionCall`; the started execution's result is returned.
- [x] Make the platform/official MCP tools call the control-plane — built on the F1 `invokeTool` routing (the executor's fallthrough proxy forwards the non-data `/v1/*` self-call to `CONTROL_PLANE_UPSTREAM`). No new deploy field required beyond F1's `MCP_SELF_BASE_URL`.

## Verify
- [x] Black-box suite green (`bash tests/blackbox/run.sh` → 808 pass / 0 fail); colocated MCP tests green (69 pass / 0 fail). The reproduction probe now passes.
- [x] Acceptance: An MCP tool starts a workflow and returns its result (`exec-1`); a platform MCP tool calls a real control-plane management route (e.g. `create_workspace`/`create_schema`) instead of the executor index.

## Archive
- [x] `openspec validate add-mcp-workflow-and-platform-binding --strict`.
- [ ] `/opsx:archive add-mcp-workflow-and-platform-binding` after merge. (Deferred — orchestrator batches archiving.)
