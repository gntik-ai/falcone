import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { JsonValue } from '@in-falcone/console-api/http'

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


export type Kind = 'table' | 'view' | 'matview'
export type Preview = { ddlPreview?: PgDdlPreview; preExecutionWarnings?: PgWarning[]; riskProfile?: PgRiskProfile }
export type Failure = { status?: number; requestId?: string; message?: string }
export const failureOf = (cause: unknown): Failure => {
  const error = cause as Failure | null
  return { status: error?.status, requestId: error?.requestId }
}
export const segment = encodeURIComponent
export const databasePath = '/v1/postgres/databases'
export const schemaPath = (database: string) => `${databasePath}/${segment(database)}/schemas`
export const objectsPath = (database: string, schema: string) => `${schemaPath(database)}/${segment(schema)}`
export const tablePath = (database: string, schema: string, table: string) => `${objectsPath(database, schema)}/tables/${segment(table)}`
export function pageUrl(path: string, cursor: string | null = null) {
  const query = new URLSearchParams({ 'page[size]': '100' })
  if (cursor !== null) query.set('page[after]', cursor)
  return `${path}?${query}`
}
export async function previewDdl(context: { tenant: string | null; workspace: string | null; database: string | null; schema: string | null }, kind: Kind, name: string, resource?: PgView | PgMatView): Promise<Preview> {
  const { tenant, workspace, database, schema } = context
  if (!tenant || !workspace || !database || !schema) throw new Error('previewPrerequisite')
  if (kind !== 'table' && !resource?.query) throw new Error(kind === 'view' ? 'viewQueryMissing' : 'matviewQueryMissing')
  const body = {
    tenantId: tenant, workspaceId: workspace, databaseName: database, schemaName: schema,
    ...(kind === 'table' ? { tableName: name } : kind === 'view' ? {
      viewName: name, query: resource!.query, columns: resource!.columns, securityBarrier: (resource as PgView).securityBarrier,
    } : { viewName: name, query: resource!.query, columns: resource!.columns, withData: (resource as PgMatView).withData, refreshPolicy: (resource as PgMatView).refreshPolicy }),
    dryRun: true, executionMode: 'preview',
  }
  const collection = kind === 'table' ? 'tables' : kind === 'view' ? 'views' : 'materialized-views'
  const result = await requestConsoleSessionJson<Preview>(`${objectsPath(database, schema)}/${collection}/${segment(name)}`, { method: 'PUT', body: body as JsonValue })
  if (!result.ddlPreview) throw new Error('previewMissing')
  return result
}
