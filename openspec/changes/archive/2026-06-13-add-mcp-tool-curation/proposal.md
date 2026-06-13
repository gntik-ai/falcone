## Why

Instant MCP (#392) deliberately emits only a **draft** manifest that is **not connectable** — because the proven lesson from production MCP servers is that raw, auto-generated tools perform poorly with LLMs. This change adds the **mandatory curation layer** that turns a draft into a connectable server: enable/disable generated tools, rewrite their descriptions to be LLM-optimized, assign per-tool scopes, preview the result, and **publish**. The publish gate is what makes a generated (or any) MCP server usable rather than a liability. It resolves issue **#393** (epic #386); consumes the draft manifest from #392, wires scopes to the OAuth AS (#390), and surfaces in the console (#397).

## What Changes

- **Curation logic** operating on a draft manifest:
  - `applyCuration(draft, curation)` — drop disabled tools, override descriptions, assign per-tool scopes (from the curator or the suggested scope), producing a **curated** manifest (`status: 'curated'`).
  - **Validation**: a mutating tool with no assigned scope is a curation violation (must be resolved before publish).
  - `publishManifest(curated)` — the **publish gate**: promotes a curated manifest to `published` only if there are no violations and at least one tool is enabled; otherwise returns the violations.
  - `isConnectable(manifest)` — true only for `published` (a draft or un-published curated manifest is **never** connectable).
  - `previewToolList(manifest)` — the resulting tool list for the console preview.
- The console surface (enable/disable toggles, description editor, scope picker, schema-driven config form, preview) is wired in the web console; this change delivers the curation/publish logic the console drives.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add the **mandatory curation + publish gate** requirements — a draft is curated (enable/disable, rewrite descriptions, assign per-tool scopes) and only a **published** curated manifest is connectable; an un-curated/un-published manifest cannot be served. Builds on the foundational `mcp` capability (#387) and the Instant MCP draft (#392).

## Impact

- **Control-plane:** `apps/control-plane/src/mcp-curation.mjs` (pure curation + publish-gate logic) + tests; consumes the `mcp-instant-generator` draft shape; scopes wire to the OAuth AS (#390).
- **Console (#397):** the curation UI (toggles, description editor, scope picker, preview) drives this logic — delivered with the Connect/console work; this PR is the logic + gate.
- **Out of scope:** the React UI itself (#397, on the web-console baseline); generation (#392); OAuth issuance (#390).
