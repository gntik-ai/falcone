import { main as createOverride } from '../../../../services/provisioning-orchestrator/src/actions/quota-override-create.mjs';
export async function seedOverrides(db, producer) {
  const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };
  await createOverride({ ...admin, tenantId: 'tenant-a', dimensionKey: 'max_pg_databases', overrideValue: 10, justification: 'Enterprise pilot' }, { db, producer });
}
