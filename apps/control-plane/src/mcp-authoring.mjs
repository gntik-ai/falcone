/**
 * First-party MCP deterministic authoring planner (change: add-control-mcp-completeness, #642).
 *
 * Turns a declarative desired-state PROJECT spec into an ordered, validated PLAN of catalog tool
 * calls — the define→deploy half of a reason→define→deploy loop. It is PURE and DETERMINISTIC:
 * NO external LLM and NO side effects. The MCP client (the LLM) performs the reasoning and then
 * DEPLOYS by executing the returned steps, calling each referenced tool in order.
 *
 * Workspace-scoped steps reference the parent workspace by `workspaceRef` (its slug) rather than an
 * id, because the id is only known after `create_workspace` runs; the client resolves the slug to
 * the created id before calling workspace-scoped tools (the plan notes this).
 */

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

/**
 * @param {object} spec  { workspaces: [{ slug, environment?, database?:{engine}, functions?, topics?, buckets? }] }
 * @param {{toolNames?: Set<string>|string[]}} [opts]  catalog tool names, to validate every step references a real tool
 * @returns {{summary:string, note:string, steps:Array<{id:string,tool:string,arguments:object,dependsOn:string[]}>}}
 * @throws {Error & {code:'INVALID_SPEC', errors?:string[]}} on an invalid/under-specified spec
 */
export function planProject(spec = {}, opts = {}) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.workspaces) || spec.workspaces.length === 0) {
    throw Object.assign(new Error('plan_project requires a non-empty `workspaces` array'), { code: 'INVALID_SPEC' });
  }
  const known = opts.toolNames instanceof Set ? opts.toolNames : new Set(opts.toolNames ?? []);
  const isKnown = (n) => known.size === 0 || known.has(n);  // no catalog provided ⇒ skip the existence check

  const errors = [];
  const steps = [];
  let seq = 0;
  const next = () => `s${++seq}`;

  spec.workspaces.forEach((ws, i) => {
    if (!ws || typeof ws.slug !== 'string' || ws.slug.trim() === '') {
      errors.push(`workspaces[${i}]: a non-empty slug is required`);
      return;
    }
    const wsStep = next();
    steps.push({ id: wsStep, tool: 'create_workspace', arguments: pick(ws, ['slug', 'environment']), dependsOn: [] });

    if (ws.database !== undefined) {
      if (!ws.database || typeof ws.database.engine !== 'string') errors.push(`workspaces[${i}].database.engine is required`);
      else steps.push({ id: next(), tool: 'provision_database', arguments: { workspaceRef: ws.slug, engine: ws.database.engine }, dependsOn: [wsStep] });
    }
    for (const fn of ws.functions ?? []) {
      if (!fn || typeof fn.name !== 'string') { errors.push(`workspaces[${i}].functions: each function needs a name`); continue; }
      steps.push({ id: next(), tool: 'register_function', arguments: { workspaceRef: ws.slug, name: fn.name, ...(fn.runtime ? { runtime: fn.runtime } : {}) }, dependsOn: [wsStep] });
    }
    for (const t of ws.topics ?? []) {
      if (typeof t !== 'string') { errors.push(`workspaces[${i}].topics: each topic must be a string name`); continue; }
      steps.push({ id: next(), tool: 'provision_topic', arguments: { workspaceRef: ws.slug, name: t }, dependsOn: [wsStep] });
    }
    for (const b of ws.buckets ?? []) {
      if (typeof b !== 'string') { errors.push(`workspaces[${i}].buckets: each bucket must be a string name`); continue; }
      steps.push({ id: next(), tool: 'provision_bucket', arguments: { workspaceRef: ws.slug, name: b }, dependsOn: [wsStep] });
    }
  });

  for (const s of steps) if (!isKnown(s.tool)) errors.push(`step ${s.id}: references unknown tool ${s.tool}`);

  if (errors.length) {
    throw Object.assign(new Error(`invalid project spec: ${errors.join('; ')}`), { code: 'INVALID_SPEC', errors });
  }

  return {
    summary: `Plan to provision ${spec.workspaces.length} workspace(s) in ${steps.length} step(s).`,
    note: 'Deterministic plan — NO changes were made. Execute each step by calling the named tool with its arguments in dependency order; resolve each workspaceRef (the workspace slug) to the workspace id returned by create_workspace before calling workspace-scoped tools.',
    steps,
  };
}
