# fix-mcp-tool-call-execution

## Change type
bugfix

## Capability
mcp

## Priority
P2

## Why
Any published instant/official MCP server → call any tool → 200 `{"service":"in-falcone-control-plane"}` (the executor index). Cause: `MCP_SELF_BASE_URL` unset (self-call hits the executor index), instant tools omit the `/rows` suffix / reference a non-existent table, official tools target control-plane routes the executor can't serve.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: create+publish an instant server → call a tool → returns the executor index JSON, not tool data.

GitHub issue #565 (epic #544). Evidence: `audit/live-campaign/evidence/24-flows-mcp-realtime.md`.

## What Changes
Set `MCP_SELF_BASE_URL`, fix the instant tool request templates, and route official/platform tools to the control-plane — `apps/control-plane` mcp-engine + deploy env.

## Impact
A hosted tool-call performs the real action and returns its result.
