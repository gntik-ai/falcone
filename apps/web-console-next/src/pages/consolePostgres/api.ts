// Wire shapes and payloads mirror the legacy PostgreSQL inventory; session owns refresh/replay.
import { requestConsoleSessionJson as request } from '@in-falcone/console-api/session'
import { createRequestId, type ApiError } from '@in-falcone/console-api/http'

export type PgDatabase = {
  databaseName: string
  state: string
  ownerRoleName: string
  placementMode: string
  tenantId: string
  workspaceId?: string
}

export type PgSchema = {
  schemaName: string
  state: string
  ownerRoleName: string
  objectCounts?: {
    tables: number
    views: number
    materializedViews: number
    indexes: number
  }
}

export type PgTable = {
  tableName: string
  state: string
  columnCount: number
}

export type PgColumn = {
  columnName: string
  dataType: {
    typeName?: string
  }
  nullable: boolean
  defaultExpression?: string
  ordinalPosition?: number
}

export type PgIndex = {
  indexName: string
  indexMethod: string
  unique?: boolean
  keys?: Array<{ columnName?: string; expression?: string }>
  includeColumns?: string[]
}

export type PgPolicy = {
  policyName: string
  policyMode: string
  state: string
  appliesTo?: {
    command?: string
    roles?: string[]
  }
  usingExpression?: string
  withCheckExpression?: string
}

export type PgSecurity = {
  rlsEnabled: boolean
  forceRls: boolean
  policyCount?: number
  sharedTableClassification?: string
  state?: string
}

export type PgView = {
  viewName: string
  state: string
  columns?: string[]
  query?: string
  securityBarrier?: boolean
}

export type PgMatView = {
  viewName: string
  state: string
  columns?: string[]
  query?: string
  withData?: boolean
  refreshPolicy?: string
  integrityProfile?: {
    populationState?: string
    withData?: boolean
  }
}

export type PgDdlStatement = {
  ordinal: number
  category: string
  destructive: boolean
  sql: string
}

export type PgDdlPreview = {
  executionMode: string
  statementCount: number
  statements: PgDdlStatement[]
  transactionMode: string
  safeGuards?: string[]
  lockTargets?: string[]
}

export type PgWarning = {
  warningCode: string
  severity: string
  category: string
  summary: string
  impactLevel: string
  requiresAcknowledgement: boolean
  detail?: string
}

export type PgRiskProfile = {
  riskLevel: string
  statementCount: number
  lockTargetCount: number
  blockingLikely: boolean
  destructive: boolean
  acknowledgementRequired: boolean
}


export type Collection<T> = { items?: T[]; page?: { nextCursor?: string } }
export type PreviewResponse = { ddlPreview?: PgDdlPreview; preExecutionWarnings?: PgWarning[]; riskProfile?: PgRiskProfile }
export type Failure = { status?: number; requestId?: string }
export function failureOf(cause: unknown): Failure {
  const error = (cause ?? {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId }
}
export const databasePath = '/v1/postgres/databases'
export const schemaPath = (database: string) => `${databasePath}/${encodeURIComponent(database)}/schemas`
export const objectPath = (database: string, schema: string) => `${schemaPath(database)}/${encodeURIComponent(schema)}`
export const tablePath = (database: string, schema: string, table: string) => `${objectPath(database, schema)}/tables/${encodeURIComponent(table)}`
export function list<T>(path: string, after: string | null): Promise<Collection<T>> {
  const query = new URLSearchParams({ 'page[size]': '100' })
  if (after) query.set('page[after]', after)
  return request<Collection<T>>(`${path}?${query}`)
}
// Security deliberately has no query string.
export const security = (path: string) => request<PgSecurity | null>(path)
export type PreviewTarget = { kind: 'table' | 'view' | 'matview'; name: string; view?: PgView | PgMatView }
export type PreviewContext = { tenant: string | null; workspace: string | null; database: string | null; schema: string | null }
export class PreviewValidation extends Error { constructor(public key: string) { super(key) } }
export async function preview(context: PreviewContext, target: PreviewTarget): Promise<PreviewResponse> {
  const { tenant, workspace, database, schema } = context
  if (!tenant || !workspace || !database || !schema) throw new PreviewValidation('previewPrerequisite')
  if (target.kind !== 'table' && !target.view?.query) throw new PreviewValidation(target.kind === 'view' ? 'previewMissingQuery' : 'previewMissingMatQuery')
  const base = { tenantId: tenant, workspaceId: workspace, databaseName: database, schemaName: schema }
  const flags = { dryRun: true, executionMode: 'preview' }
  const view = target.view
  const resource = target.kind === 'table' ? 'tables' : target.kind === 'view' ? 'views' : 'materialized-views'
  const body = target.kind === 'table' ? { ...base, tableName: target.name, ...flags }
    : target.kind === 'view' ? { ...base, viewName: target.name, query: view!.query!, ...(view!.columns === undefined ? {} : { columns: view!.columns }), ...((view as PgView).securityBarrier === undefined ? {} : { securityBarrier: (view as PgView).securityBarrier! }), ...flags }
      : { ...base, viewName: target.name, query: view!.query!, ...(view!.columns === undefined ? {} : { columns: view!.columns }), ...((view as PgMatView).withData === undefined ? {} : { withData: (view as PgMatView).withData! }), ...((view as PgMatView).refreshPolicy === undefined ? {} : { refreshPolicy: (view as PgMatView).refreshPolicy! }), ...flags }
  const response = await request<PreviewResponse>(`${objectPath(database, schema)}/${resource}/${encodeURIComponent(target.name)}`, { method: 'PUT', body })
  if (!response.ddlPreview) throw new PreviewValidation('previewMissingDdl')
  return response
}
export type Quotas = { dimensions?: { dimensionId?: string; hardLimit?: number | null; measuredValue?: number }[]; hardLimitBreaches?: string[] }
export type Overview = { hardLimitDimensions?: string[] }
export async function checkQuota(tenant: string | null, workspace: string | null) {
  if (!tenant) return true
  await Promise.all([
    request<Quotas>(`/v1/metrics/tenants/${tenant}/quotas`),
    request<Overview>(`/v1/metrics/tenants/${tenant}/overview`),
  ])
  if (!workspace) return true
  const [quotas, overview] = await Promise.all([
    request<Quotas>(`/v1/metrics/workspaces/${workspace}/quotas`),
    request<Overview>(`/v1/metrics/workspaces/${workspace}/overview`),
  ])
  if (tenant === 'platform') return true
  const dimension = quotas.dimensions?.find((item) => item.dimensionId === 'databases.count')
  if (!dimension) return true
  const percent = dimension.hardLimit && dimension.hardLimit > 0 ? Math.round((dimension.measuredValue ?? 0) / dimension.hardLimit * 100) : 0
  return percent < 100 && ![...(quotas.hardLimitBreaches ?? []), ...(overview.hardLimitDimensions ?? [])].includes('databases.count')
}
export type CreateBody = { engine: string; name: string; extensions: string[]; collections: string[] }
export const createDatabase = (workspace: string, body: CreateBody) => request<{ databaseId: string }>(`/v1/workspaces/${workspace}/databases`, {
  method: 'POST', body, idempotent: true, headers: { 'X-Request-Id': createRequestId('wiz') },
})
