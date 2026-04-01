import type { PrecheckResult } from './precheck.types.js'
import type { SnapshotInfo } from '../../adapters/types.js'

export interface SnapshotLister {
  listSnapshots(instanceId: string, tenantId: string, context: unknown): Promise<SnapshotInfo[]>
}

export async function snapshotExistsPrecheck(
  tenantId: string,
  componentType: string,
  instanceId: string,
  snapshotId: string,
  adapterClient: SnapshotLister | null,
  adapterContext: unknown,
): Promise<PrecheckResult> {
  if (!adapterClient) {
    return {
      result: 'warning',
      code: 'snapshot_exists_check',
      message: 'No se pudo verificar el snapshot: adaptador no disponible.',
    }
  }

  try {
    const snapshots = await adapterClient.listSnapshots(instanceId, tenantId, adapterContext)
    const snapshot = snapshots.find((s) => s.snapshotId === snapshotId)
    if (!snapshot) {
      return {
        result: 'blocking_error',
        code: 'snapshot_exists_check',
        message: 'El snapshot solicitado no existe o no pertenece al target.',
        metadata: { snapshot_id: snapshotId, tenant_id: tenantId, component_type: componentType },
      }
    }
    if (!snapshot.available) {
      return {
        result: 'blocking_error',
        code: 'snapshot_exists_check',
        message: 'El snapshot existe pero no está disponible.',
        metadata: { snapshot_id: snapshotId },
      }
    }

    return {
      result: 'ok',
      code: 'snapshot_exists_check',
      message: 'El snapshot existe y está disponible.',
    }
  } catch {
    return {
      result: 'warning',
      code: 'snapshot_exists_check',
      message: 'No se pudo completar la verificación del snapshot.',
    }
  }
}
