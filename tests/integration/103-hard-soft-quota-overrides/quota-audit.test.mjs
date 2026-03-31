import test from 'node:test'; import assert from 'node:assert/strict';
import { main as createOverride } from '../../../services/provisioning-orchestrator/src/actions/quota-override-create.mjs';
import { main as enforce } from '../../../services/provisioning-orchestrator/src/actions/quota-enforce.mjs';
import { main as queryAudit } from '../../../services/provisioning-orchestrator/src/actions/quota-audit-query.mjs';
import { createFakeDb, createFakeProducer, seedPlans } from './fixtures/seed-plans-with-quota-types.mjs';
const admin={ callerContext:{ actor:{ id:'admin-1', type:'superadmin' } } };
test('audit query returns override lifecycle and enforcement entries', async()=>{ const db=createFakeDb(); const producer=createFakeProducer(); seedPlans(db); await createOverride({ ...admin, tenantId:'tenant-a', dimensionKey:'max_pg_databases', overrideValue:10, justification:'pilot' }, { db, producer }); await enforce({ tenantId:'tenant-a', dimensionKey:'max_workspaces', currentUsage:5 }, { db, producer }); const result=await queryAudit({ tenantId:'tenant-a', callerContext:{ actor:{ id:'admin-1', type:'superadmin' } } }, { db }); assert.ok(result.body.total >= 2); });
