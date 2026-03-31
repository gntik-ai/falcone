import test from 'node:test'; import assert from 'node:assert/strict';
import { main as createOverride } from '../../../services/provisioning-orchestrator/src/actions/quota-override-create.mjs';
import { main as sweep } from '../../../services/provisioning-orchestrator/src/actions/quota-override-expiry-sweep.mjs';
import { createFakeDb, createFakeProducer, seedPlans } from './fixtures/seed-plans-with-quota-types.mjs';
const admin={ callerContext:{ actor:{ id:'admin-1', type:'superadmin' } } };
test('expiry sweep transitions expired override', async()=>{ const db=createFakeDb(); seedPlans(db); const row = await createOverride({ ...admin, tenantId:'tenant-a', dimensionKey:'max_functions', overrideValue:70, justification:'temp', expiresAt:new Date(Date.now()+1000).toISOString() }, { db, producer:createFakeProducer() }); const result=await sweep({ now:new Date(Date.now()+2000).toISOString() }, { db, producer:createFakeProducer() }); assert.equal(result.body.expiredCount, 1); assert.equal(result.body.overrides[0].overrideId, row.body.overrideId); });
