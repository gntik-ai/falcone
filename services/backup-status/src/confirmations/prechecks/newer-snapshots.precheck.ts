import type { PrecheckResult } from './precheck.types.js'
import type { SnapshotInfo } from '../../adapters/types.js'

export interface SnapshotLister {
  listSnapshots(instanceId: string, tenantId: string, context: unknown): Promise<SnapshotInfo[]>
}

export async function newerSnapshotsPrecheck(
  tenantId: string,
  componentType: string,
  instanceId: string,
  snapshotId: string,
  snapshotCreatedAt: Date,
  adapterClient: SnapshotLister | null,
  adapterContext: unknown,
): Promise<PrecheckResult> {
  if (!adapterClient) {
    return {
      result: 'ok',
      code: 'newer_snapshots_check',
      message: 'No se pudo verificar snapshots más recientes: adaptador no disponible.',
    }
  }

  try {
    const snapshots = await adapterClient.listSnapshots(instanceId, tenantId, adapterContext)
    const newer = snapshots.filter((s) => s.snapshotId !== snapshotId && s.createdAt > snapshotCreatedAt && s.available)
    if (newer.length > 0) {
      return {
        result: 'warning',
        code: 'newer_snapshots_check',
        message: `Existen ${newer.length} snapshots más recientes que el seleccionado.`,
        metadata: { newer_count: newer.length, tenant_id: tenantId, component_type: componentType },
      }
    }

    return {
      result: 'ok',
      code: 'newer_snapshots_check',
      message: 'No existen snapshots más recientes que el seleccionado.',
    }
  } catch {
    return {
      result: 'warning',
      code: 'newer_snapshots_check',
      message: 'No se pudo completar la verificación de snapshots más recientes.',
    }
  }
}
