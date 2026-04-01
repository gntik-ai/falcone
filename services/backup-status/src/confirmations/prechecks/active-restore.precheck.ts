import type { PrecheckResult } from './precheck.types.js'

export interface ActiveRestoreRepo {
  findActive(tenantId: string, componentType: string, instanceId: string, type: 'restore'): Promise<{ id: string } | null>
}

export async function activeRestorePrecheck(
  tenantId: string,
  componentType: string,
  instanceId: string,
  repo: ActiveRestoreRepo,
): Promise<PrecheckResult> {
  const active = await repo.findActive(tenantId, componentType, instanceId, 'restore')
  if (active) {
    return {
      result: 'blocking_error',
      code: 'active_restore_check',
      message: 'Ya existe una operación de restauración activa para este componente.',
      metadata: { conflict_operation_id: active.id },
    }
  }

  return {
    result: 'ok',
    code: 'active_restore_check',
    message: 'No hay operaciones de restauración activas para este componente.',
  }
}
