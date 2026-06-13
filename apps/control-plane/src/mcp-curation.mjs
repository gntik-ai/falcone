/**
 * MCP tool curation + publish gate (change: add-mcp-tool-curation, #393; epic #386).
 *
 * The mandatory layer between a DRAFT manifest (from mcp-instant-generator #392, or any candidate
 * tool set) and a connectable server. Pure, deterministic transforms:
 *   - applyCuration: enable/disable tools, override descriptions, assign per-tool scopes -> curated
 *   - publishManifest: the gate — only publishes if every enabled mutating tool has a scope and
 *     at least one tool is enabled; otherwise returns violations
 *   - isConnectable: true ONLY for a published manifest (a draft / un-published curated set is
 *     never connectable — this is what keeps #392's "raw is never served" invariant true e2e)
 */

function curationViolations(tools) {
  const v = [];
  if (tools.length === 0) v.push({ code: 'no_enabled_tools', message: 'At least one tool must be enabled to publish.' });
  for (const t of tools) {
    if (t.mutates && !t.scope) {
      v.push({ code: 'mutating_tool_without_scope', tool: t.name, message: `Mutating tool "${t.name}" must be assigned a scope before publishing.` });
    }
  }
  return v;
}

/**
 * Apply a curation to a draft manifest, producing a curated manifest.
 * @param {object} draft  a manifest with { tools:[{name, description, mutates, suggestedScope, ...}] }
 * @param {{decisions?: Record<string,{enabled?:boolean, description?:string, scope?:string}>}} [curation]
 * @returns {object} curated manifest { ...draft, status:'curated', requiresCuration:false, tools, violations }
 */
export function applyCuration(draft, curation = {}) {
  const decisions = curation.decisions ?? {};
  const tools = (draft?.tools ?? [])
    .filter((t) => decisions[t.name]?.enabled !== false) // enabled by default; only explicit false drops it
    .map((t) => {
      const d = decisions[t.name] ?? {};
      const scope = d.scope ?? t.suggestedScope ?? null;
      return {
        ...t,
        description: d.description ?? t.description,
        scope,
        // a read tool keeps scope null; mutating tools resolve to curator/suggested scope
      };
    });
  return {
    ...draft,
    status: 'curated',
    requiresCuration: false,
    tools,
    violations: curationViolations(tools),
  };
}

/**
 * Publish gate: promote a curated manifest to 'published' iff it has no violations.
 * @param {object} curated  a manifest returned by applyCuration
 * @returns {{ ok: boolean, manifest?: object, violations: Array }}
 */
export function publishManifest(curated) {
  if (curated?.status !== 'curated') {
    return { ok: false, violations: [{ code: 'not_curated', message: 'Only a curated manifest can be published.' }] };
  }
  const violations = curationViolations(curated.tools ?? []);
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true, manifest: { ...curated, status: 'published', requiresCuration: false, violations: [] }, violations: [] };
}

/** A tool set is connectable ONLY when published. */
export function isConnectable(manifest) {
  return manifest?.status === 'published';
}

/** The resulting tool list for the console preview. */
export function previewToolList(manifest) {
  return (manifest?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    mutates: !!t.mutates,
    scope: t.scope ?? t.suggestedScope ?? null,
  }));
}
