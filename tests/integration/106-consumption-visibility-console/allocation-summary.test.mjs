import test from 'node:test';
import assert from 'node:assert/strict';
import { main as allocationSummary } from '../../../services/provisioning-orchestrator/src/actions/tenant-workspace-allocation-summary-get.mjs';
import { seedWorkspaceWithSubQuotas } from './fixtures/seed-workspace-with-sub-quotas.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

function makePostgresAllocationClient(subQuotas = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      if (text.includes('FROM quota_dimension_catalog c')) {
        return {
          rows: [
            { dimension_key: 'max_pg_databases', display_label: 'PostgreSQL Databases', unit: 'count', effective_value: 5, source: 'plan', quota_type: 'hard', grace_margin: 0, plan_slug: 'professional', plan_status: 'active', sort_order: 10 },
            { dimension_key: 'max_functions', display_label: 'Functions', unit: 'count', effective_value: 20, source: 'plan', quota_type: 'hard', grace_margin: 0, plan_slug: 'professional', plan_status: 'active', sort_order: 20 }
          ]
        };
      }
      if (text.includes('FROM tenant_plan_assignments tpa JOIN plans p')) {
        return { rows: [{ slug: 'professional', status: 'active', capabilities: {} }] };
      }
      if (text.includes('FROM boolean_capability_catalog')) {
        return { rows: [] };
      }
      if (text.includes('FROM workspace_sub_quotas')) {
        const tenantId = params[0];
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        const matching = subQuotas
          .filter((row) => (row.tenant_id ?? row.tenantId) === tenantId)
          .sort((left, right) => {
            const byWorkspace = String(left.workspace_id ?? left.workspaceId).localeCompare(String(right.workspace_id ?? right.workspaceId));
            return byWorkspace || String(left.dimension_key ?? left.dimensionKey).localeCompare(String(right.dimension_key ?? right.dimensionKey));
          });
        return {
          rows: matching.slice(offset, offset + limit).map((row) => ({
            id: row.id,
            tenant_id: row.tenant_id ?? row.tenantId,
            workspace_id: row.workspace_id ?? row.workspaceId,
            dimension_key: row.dimension_key ?? row.dimensionKey,
            allocated_value: row.allocated_value ?? row.allocatedValue,
            created_by: row.created_by ?? row.createdBy ?? 'seed',
            updated_by: row.updated_by ?? row.updatedBy ?? 'seed',
            created_at: row.created_at ?? row.createdAt ?? new Date().toISOString(),
            updated_at: row.updated_at ?? row.updatedAt ?? new Date().toISOString(),
            total: matching.length
          }))
        };
      }
      if (text.includes('COUNT(*)::bigint AS value') || text.includes('COALESCE(SUM(size_bytes), 0)::float8')) {
        return { rows: [{ value: 0 }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };
}

test('allocation summary returns arithmetic per dimension', async () => {
  const db = seedWorkspaceWithSubQuotas();
  const result = await allocationSummary({ ...admin, tenantId: 'pro-corp' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.totalAllocated, 11);
  assert.equal(entry.unallocated, 0);
  assert.equal(entry.isFullyAllocated, true);
});

test('allocation summary includes persisted workspace_sub_quotas rows from postgres', async () => {
  const db = makePostgresAllocationClient([
    { id: 'sq-1', tenant_id: 'pro-corp', workspace_id: 'ws-prod', dimension_key: 'max_pg_databases', allocated_value: 2 },
    { id: 'sq-other', tenant_id: 'other-corp', workspace_id: 'ws-other', dimension_key: 'max_pg_databases', allocated_value: 99 }
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(db, '_workspaceSubQuotas'), false);

  const result = await allocationSummary({ ...admin, tenantId: 'pro-corp' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');

  assert.equal(entry.totalAllocated, 2);
  assert.equal(entry.unallocated, 3);
  assert.equal(entry.isFullyAllocated, false);
  assert.deepEqual(entry.workspaces, [{ workspaceId: 'ws-prod', allocatedValue: 2 }]);
  assert.ok(db.calls.some((call) => call.sql.includes('FROM workspace_sub_quotas')), 'summary queried persisted workspace_sub_quotas');
});

test('allocation summary returns every dimension with empty workspaces when postgres has no rows', async () => {
  const db = makePostgresAllocationClient([]);
  const result = await allocationSummary({ ...admin, tenantId: 'pro-corp' }, { db });

  assert.deepEqual(result.body.dimensions.map((entry) => entry.dimensionKey), ['max_pg_databases', 'max_functions']);
  assert.ok(result.body.dimensions.every((entry) => entry.totalAllocated === 0));
  assert.ok(result.body.dimensions.every((entry) => entry.workspaces.length === 0));
  assert.ok(db.calls.some((call) => call.sql.includes('FROM workspace_sub_quotas')), 'summary checked persisted workspace_sub_quotas');
});
