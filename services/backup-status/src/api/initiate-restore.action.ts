import { validateToken, AuthError } from './backup-status.auth.js'
import { adapterRegistry, isActionAdapter } from '../adapters/registry.js'
import type { AdapterContext, BackupActionAdapter } from '../adapters/types.js'
import { initiate, ConfirmationError, toSnakeCaseInitiate } from '../confirmations/confirmations.service.js'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_body?: string
}

export async function main(params: ActionParams) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

  try {
    const auth = params.__ow_headers?.authorization ?? params.__ow_headers?.Authorization
    const rawToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (!rawToken) return { statusCode: 401, headers, body: { error: 'Missing authorization' } }

    const token = await validateToken(rawToken)
    if (!token.scopes.includes('backup:restore:global') && !token.scopes.includes('superadmin')) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    if (!params.__ow_body) {
      return { statusCode: 400, headers, body: { error: 'Missing request body' } }
    }

    const body = JSON.parse(Buffer.from(params.__ow_body, 'base64').toString()) as {
      tenant_id?: string
      component_type?: string
      instance_id?: string
      snapshot_id?: string
      scope?: 'partial' | 'full'
    }

    if (!body.tenant_id || !body.component_type || !body.instance_id || !body.snapshot_id) {
      return { statusCode: 400, headers, body: { error: 'Missing required fields: tenant_id, component_type, instance_id, snapshot_id' } }
    }

    const adapter = adapterRegistry.get(body.component_type)
    const adapterContext: AdapterContext = {
      deploymentProfile: process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default',
      serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
      k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
    }

    const resolveSnapshotCreatedAt = async (): Promise<Date | null> => {
      if (!isActionAdapter(adapter)) return null
      const snapshots = await (adapter as BackupActionAdapter).listSnapshots(body.instance_id!, body.tenant_id!, adapterContext)
      const snap = snapshots.find((s) => s.snapshotId === body.snapshot_id)
      return snap?.createdAt ?? null
    }

    const response = await initiate(
      {
        tenant_id: body.tenant_id,
        component_type: body.component_type,
        instance_id: body.instance_id,
        snapshot_id: body.snapshot_id,
        scope: body.scope,
      },
      { sub: token.sub, tenantId: token.tenantId, role: token.scopes.includes('superadmin') ? 'superadmin' : 'sre', scopes: token.scopes },
      {
        operationsRepo: {
          findActive: async (tenantId: string, componentType: string, instanceId: string, type: 'restore') => {
            const mod = await import('../operations/operations.repository.js')
            return await mod.findActive(tenantId, componentType, instanceId, type)
          },
        },
        adapterClient: isActionAdapter(adapter) ? (adapter as BackupActionAdapter) : null,
        adapterContext,
      },
      await resolveSnapshotCreatedAt() ?? undefined,
      body.tenant_id,
    )

    return { statusCode: 202, headers, body: toSnakeCaseInitiate(response) }
  } catch (err) {
    if (err instanceof ConfirmationError) {
      return { statusCode: err.statusCode, headers, body: { error: err.code, ...err.detail } }
    }
    if (err instanceof AuthError) {
      return { statusCode: err.statusCode, headers, body: { error: err.message } }
    }
    console.error('[initiate-restore] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}
