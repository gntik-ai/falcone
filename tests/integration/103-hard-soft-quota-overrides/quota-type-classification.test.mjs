import test from 'node:test'; import assert from 'node:assert/strict';
import { main as setLimit } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-set.mjs';
import { main as profileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs';
import { createFakeDb, createFakeProducer, seedPlans } from './fixtures/seed-plans-with-quota-types.mjs';
const admin={ callerContext:{ actor:{ id:'admin-1', type:'superadmin' } } };
test('persists hard/soft quota metadata and default hard fallback', async()=>{ const db=createFakeDb(); seedPlans(db); await setLimit({ ...admin, planId:'plan-active', dimensionKey:'max_functions', value:50, quotaType:'soft', graceMargin:0 }, { db, producer:createFakeProducer() }); const response=await profileGet({ ...admin, planId:'plan-active' }, { db }); assert.equal(response.body.profile.find((x)=>x.dimensionKey==='max_functions').quotaType, 'soft'); assert.equal(response.body.profile.find((x)=>x.dimensionKey==='max_api_keys').quotaType, 'hard'); });
