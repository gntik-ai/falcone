/**
 * Flows API client for E2E specs.
 *
 * Wraps the Playwright `APIRequestContext` to call the control-plane flows API
 * directly (bypassing the APISIX gateway, which does not route /v1/flows/* yet —
 * deferred in #374). Every call carries the gateway-injected identity headers
 * that the control-plane server.mjs reads from `identityFromHeaders`.
 *
 * Usage:
 *   const client = createFlowsApiClient(request, { baseUrl: CP_BASE_URL, ...tenant });
 *   await client.createFlow(wsId, def);
 *
 * Covers: fn-flows-create, fn-flows-publish, fn-flows-execute, fn-flows-signal,
 *         fn-flows-cancel, fn-flows-retry, fn-flows-tenant-isolation.
 */

import type { APIRequestContext } from '@playwright/test'
import type { FlowDefinition } from '../../fixtures/flows/flow-definitions'

export interface TenantIdentity {
  tenantId: string
  workspaceId: string
  actorId?: string
  roleName?: string
}

export interface FlowsApiClientOptions {
  /** Direct URL to the control-plane service, e.g. http://localhost:8080 */
  baseUrl: string
  /** Tenant/workspace identity headers (gateway-injected in production) */
  identity: TenantIdentity
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = Record<string, any>

export function createFlowsApiClient(request: APIRequestContext, opts: FlowsApiClientOptions) {
  const { baseUrl, identity } = opts

  function identityHeaders(): Record<string, string> {
    return {
      'x-tenant-id': identity.tenantId,
      'x-workspace-id': identity.workspaceId,
      'x-auth-subject': identity.actorId ?? 'e2e-actor',
      'x-pg-role': identity.roleName ?? 'falcone_app',
      'content-type': 'application/json',
      accept: 'application/json',
    }
  }

  const enc = encodeURIComponent
  const flowsBase = (wsId: string) =>
    `${baseUrl}/v1/flows/workspaces/${enc(wsId)}/flows`

  async function get<T>(url: string): Promise<T> {
    const res = await request.get(url, { headers: identityHeaders() })
    if (!res.ok()) {
      throw new Error(`GET ${url} → ${res.status()}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }

  async function post<T>(url: string, body?: JsonBody): Promise<T> {
    const res = await request.post(url, {
      headers: identityHeaders(),
      data: body ?? {},
    })
    if (!res.ok()) {
      throw new Error(`POST ${url} → ${res.status()}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }

  async function patch<T>(url: string, body?: JsonBody): Promise<T> {
    const res = await request.patch(url, {
      headers: identityHeaders(),
      data: body ?? {},
    })
    if (!res.ok()) {
      throw new Error(`PATCH ${url} → ${res.status()}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }

  async function del(url: string): Promise<void> {
    await request.delete(url, { headers: identityHeaders() })
  }

  return {
    // ---- Flow definitions ----
    listFlows: (wsId: string) =>
      get<{ items: Array<{ flowId: string; name: string; status?: string }> }>(flowsBase(wsId)),

    createFlow: (wsId: string, payload: { name: string; definition?: FlowDefinition }) =>
      post<{ flowId: string; name: string; status?: string }>(flowsBase(wsId), payload),

    getFlow: (wsId: string, flowId: string) =>
      get<{ flowId: string; name: string; status?: string; definition?: FlowDefinition }>(
        `${flowsBase(wsId)}/${enc(flowId)}`,
      ),

    updateFlow: (wsId: string, flowId: string, payload: { definition: FlowDefinition }) =>
      patch<{ flowId: string; name: string; status?: string }>(
        `${flowsBase(wsId)}/${enc(flowId)}`,
        payload,
      ),

    validateFlow: (wsId: string, flowId: string) =>
      post<{ valid: boolean }>(`${flowsBase(wsId)}/${enc(flowId)}/validate`),

    publishFlow: (wsId: string, flowId: string) =>
      post<{
        flowId: string
        version: number
        createdAt?: string
        /** Trigger registrations by kind (returned when triggers are registered). */
        triggers?: {
          cron?: string[]
          webhooks?: Array<{ triggerId: string; secret?: string }>
          events?: Array<{ triggerId: string; topicRef?: string }>
        }
      }>(
        `${flowsBase(wsId)}/${enc(flowId)}/versions`,
      ),

    listVersions: (wsId: string, flowId: string) =>
      get<{ items: Array<{ version: number; flowId?: string; createdAt?: string }> }>(
        `${flowsBase(wsId)}/${enc(flowId)}/versions`,
      ),

    deleteFlow: (wsId: string, flowId: string) =>
      del(`${flowsBase(wsId)}/${enc(flowId)}`),

    // ---- Executions ----
    startExecution: (wsId: string, flowId: string, payload?: { version?: number; input?: JsonBody }) =>
      post<{ executionId: string; status?: string }>(
        `${flowsBase(wsId)}/${enc(flowId)}/executions`,
        payload ?? {},
      ),

    listExecutions: (wsId: string, flowId: string) =>
      get<{ items: Array<{ executionId: string; status?: string }> }>(
        `${flowsBase(wsId)}/${enc(flowId)}/executions`,
      ),

    getExecution: (wsId: string, flowId: string, execId: string) =>
      get<{
        executionId: string
        status?: string
        version?: string | number
        startedAt?: string
        closedAt?: string
        input?: JsonBody | null
        result?: JsonBody | null
        /** ActivityScheduled events per node (one per executed node) */
        events?: Array<{ nodeId: string; eventId: string; type: string }>
        /** Legacy alias (not returned by the real API; kept for type compatibility) */
        nodes?: Array<{ nodeId: string; status?: string; output?: JsonBody }>
      }>(`${flowsBase(wsId)}/${enc(flowId)}/executions/${enc(execId)}`),

    cancelExecution: (wsId: string, flowId: string, execId: string) =>
      post<{ executionId: string; status: string }>(
        `${flowsBase(wsId)}/${enc(flowId)}/executions/${enc(execId)}/cancellations`,
      ),

    retryExecution: (wsId: string, flowId: string, execId: string) =>
      post<{ executionId: string; status: string; version?: number }>(
        `${flowsBase(wsId)}/${enc(flowId)}/executions/${enc(execId)}/retries`,
      ),

    sendSignal: (
      wsId: string,
      flowId: string,
      execId: string,
      signalName: string,
      payload: JsonBody,
    ) =>
      post<{ executionId: string; signal: string; delivered: boolean }>(
        `${flowsBase(wsId)}/${enc(flowId)}/executions/${enc(execId)}/signals/${enc(signalName)}`,
        payload,
      ),

    // ---- Task types (palette) ----
    listTaskTypes: (wsId: string) =>
      get<Array<{ id: string; label: string; category?: string }>>(
        `${baseUrl}/v1/flows/workspaces/${enc(wsId)}/task-types`,
      ),
  }
}

export type FlowsApiClient = ReturnType<typeof createFlowsApiClient>
