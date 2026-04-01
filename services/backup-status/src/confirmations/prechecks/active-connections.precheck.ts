import type { PrecheckResult } from './precheck.types.js'

export interface ConnectionChecker {
  checkActiveConnections?(instanceId: string, tenantId: string, context: unknown): Promise<{ count?: number } | number | null>
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ])
}

export async function activeConnectionsPrecheck(
  tenantId: string,
  componentType: string,
  instanceId: string,
  adapterClient: ConnectionChecker | null,
  adapterContext: unknown,
): Promise<PrecheckResult> {
  if (!adapterClient || typeof adapterClient.checkActiveConnections !== 'function') {
    return {
      result: 'warning',
      code: 'active_connections_check',
      message: 'Verificación de conexiones activas no disponible para este componente.',
    }
  }

  try {
    const result = await withTimeout(adapterClient.checkActiveConnections(instanceId, tenantId, adapterContext), 3_000)
    const count = typeof result === 'number' ? result : result?.count ?? 0
    if (count > 0) {
      return {
        result: 'warning',
        code: 'active_connections_check',
        message: 'Se detectan conexiones activas en el componente.',
        metadata: { active_connections_count: count, component_type: componentType },
      }
    }

    return {
      result: 'ok',
      code: 'active_connections_check',
      message: 'No se detectan conexiones activas inusuales.',
    }
  } catch {
    return {
      result: 'warning',
      code: 'active_connections_check',
      message: 'Verificación de conexiones activas no disponible para este componente.',
    }
  }
}
