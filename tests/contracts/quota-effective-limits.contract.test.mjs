import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { main as effectiveLimits } from '../../packages/provisioning-orchestrator/src/actions/quota-effective-limits-get.mjs';
import { validate } from '../../packages/provisioning-orchestrator/src/schemas/schema-validator.mjs';
import { createFakeDb, seedPlans } from '../integration/103-hard-soft-quota-overrides/fixtures/seed-plans-with-quota-types.mjs';
const schema=JSON.parse(await fs.readFile(new URL('./schemas/quota-effective-limits-get.json', import.meta.url), 'utf8'));
const admin={ callerContext:{ actor:{ id:'admin-1', type:'superadmin' } } };

test('planless effective-limits response validates against the contract', async()=>{ const response=await effectiveLimits({ ...admin, tenantId:'tenant-planless' }, { db:createFakeDb() }); assert.deepEqual(validate(response.body, schema).errors, []); });

test('plan-assigned effective-limits response validates against the contract', async()=>{ const db=createFakeDb(); seedPlans(db); const response=await effectiveLimits({ ...admin, tenantId:'tenant-a' }, { db }); assert.deepEqual(validate(response.body, schema).errors, []); });

test('contract requires plan identity keys and a boolean noAssignment when present', ()=>{ const body={ tenantId:'tenant-planless', planSlug:null, planStatus:null, noAssignment:true, effectiveLimits:[] }; assert.deepEqual(validate(body, schema).errors, []); assert.equal(validate({ ...body, noAssignment:'true' }, schema).valid, false); for (const key of ['planSlug', 'planStatus']) { const missing={ ...body }; delete missing[key]; assert.equal(validate(missing, schema).valid, false); } });
