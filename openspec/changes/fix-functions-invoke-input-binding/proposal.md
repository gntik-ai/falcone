# fix-functions-invoke-input-binding

## Change type
bugfix

## Capability
functions

## Priority
P2

## Why
`fnInvoke` reads `body.parameters`; `{"n":21}` silently → `{doubled:0}` (only `{"parameters":{...}}` works).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: invoke with `{n:21}` → `{doubled:0}`; with `{parameters:{n:21}}` → `{doubled:42}`.

GitHub issue #570 (epic #546). Evidence: `audit/live-campaign/evidence/23-events-functions.md`.

## What Changes
Accept top-level input (or document the envelope and validate) — kind `fn-handlers.mjs` + product functions invoke.

## Impact
The documented shape returns the correct result; an unexpected shape 4xx, not a silent wrong answer.
