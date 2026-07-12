// Unit tests for the deterministic MCP authoring planner (add-control-mcp-completeness, #642).
import test from 'node:test';
import assert from 'node:assert/strict';
import { planProject } from './mcp-authoring.mjs';
import { OFFICIAL_TOOLS } from './mcp-official-catalog.mjs';

const toolNames = new Set(OFFICIAL_TOOLS.map((t) => t.name));

test('orders steps so dependents follow create_workspace', () => {
  const plan = planProject({
    workspaces: [{ slug: 'app', environment: 'dev', database: { engine: 'postgresql' }, functions: [{ name: 'fn', runtime: 'nodejs' }], topics: ['t1'], buckets: ['b1'] }],
  }, { toolNames });
  assert.equal(plan.steps[0].tool, 'create_workspace');
  const wsId = plan.steps[0].id;
  for (const s of plan.steps.slice(1)) assert.deepEqual(s.dependsOn, [wsId]);
  const tools = plan.steps.map((s) => s.tool);
  assert.deepEqual(tools, ['create_workspace', 'provision_database', 'register_function', 'provision_topic', 'provision_bucket']);
});

test('every referenced tool exists in the catalog', () => {
  const plan = planProject({ workspaces: [{ slug: 'a' }, { slug: 'b', database: { engine: 'mongodb' } }] }, { toolNames });
  for (const s of plan.steps) assert.ok(toolNames.has(s.tool), `unknown tool ${s.tool}`);
});

test('it is deterministic and side-effect-free (same input → same plan)', () => {
  const spec = { workspaces: [{ slug: 'x', functions: [{ name: 'f1' }, { name: 'f2' }] }] };
  assert.deepEqual(planProject(spec, { toolNames }), planProject(spec, { toolNames }));
});

test('rejects an empty/invalid spec', () => {
  assert.throws(() => planProject({ workspaces: [] }, { toolNames }), /non-empty/);
  assert.throws(() => planProject({}, { toolNames }), /non-empty/);
  assert.throws(() => planProject({ workspaces: [{ environment: 'dev' }] }, { toolNames }), /slug/);
});

test('rejects an under-specified database', () => {
  assert.throws(() => planProject({ workspaces: [{ slug: 'a', database: {} }] }, { toolNames }), /engine/);
});

test('the note tells the client to resolve workspaceRef before workspace-scoped calls', () => {
  const plan = planProject({ workspaces: [{ slug: 'a', database: { engine: 'postgresql' } }] }, { toolNames });
  assert.match(plan.note, /workspaceRef/);
  assert.equal(plan.steps.find((s) => s.tool === 'provision_database').arguments.workspaceRef, 'a');
});
