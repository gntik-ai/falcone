## 1. Verify real state (code, not intent)

- [x] 1.1 Flows = Preview: `flow-definition.json` DSL, `/v1/flows` runtime routes, interpreter worker, archived `workflows` spec, full guide
- [x] 1.2 MCP = Preview: `/v1/mcp` + `mcp-engine` on `main` (runtime wiring merged); `draftForSource` wires instant + official; custom-hosting + workflows-as-tools modules exist but not on the live create path (Experimental); engine state in-memory
- [x] 1.3 Storage: `git grep` across all branches/OpenSpec/issues/PRs for SeaweedFS/FerretDB/DocumentDB = 0 → planned/under-evaluation; current stack MinIO + MongoDB; licenses table already accurate (no change)

## 2. Status refresh

- [x] 2.1 `README.md` + `README.{es,de,fr,ru,zh}.md`: Built-for-AI bullets → Preview (present tense); roadmap split Shipped(Preview) / in-progress / planned; capabilities table Flows → Preview + new MCP row; planned storage note
- [x] 2.2 `docs-site/guide/{flows,mcp,roadmap}.md` + `docs-site/architecture/mcp.md`: Preview banners, live `/v1/mcp` surface, per-layer status, roadmap shipped-vs-planned
- [x] 2.3 `apps/mcp-server-sdk/README.md`: Preview note

## 3. New concrete detail

- [x] 3.1 `docs-site/architecture/workflow-dsl-reference.md` (new): complete DSL reference with valid YAML for every node/task/trigger; sidebar entry (`config.mts`); cross-link from the Flows guide
- [x] 3.2 MCP examples in `docs-site/guide/mcp.md`: real route table + create→curate→publish→call→audit curl flow + Instant-generated tool definition

## 4. Verify

- [x] 4.1 VitePress build dead-link clean; `markdownlint` 0 errors; not-production-ready posture preserved
- [x] 4.2 `openspec validate refresh-flows-mcp-docs --strict` passes

## 5. Finalize

- [x] 5.1 No license-table change (already accurate); no code/schema change; storage migrations documented as planned (no artifacts in the repo)
