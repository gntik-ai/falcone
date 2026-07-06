import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { ProvisionDatabaseWizard } from '@/components/console/wizards/ProvisionDatabaseWizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError } from '@/lib/console-errors'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { SnippetContext } from '@/lib/snippets/snippet-types'

type PgDatabase = {
  databaseName: string
  state: string
  ownerRoleName: string
  placementMode: string
  tenantId: string
  workspaceId?: string
}

type PgSchema = {
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

type PgTable = {
  tableName: string
  state: string
  columnCount: number
}

type PgColumn = {
  columnName: string
  dataType: {
    typeName?: string
  }
  nullable: boolean
  defaultExpression?: string
  ordinalPosition?: number
}

type PgIndex = {
  indexName: string
  indexMethod: string
  unique?: boolean
  keys?: Array<{ columnName?: string; expression?: string }>
  includeColumns?: string[]
}

type PgPolicy = {
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

type PgSecurity = {
  rlsEnabled: boolean
  forceRls: boolean
  policyCount?: number
  sharedTableClassification?: string
  state?: string
}

type PgView = {
  viewName: string
  state: string
  columns?: string[]
  query?: string
  securityBarrier?: boolean
}

type PgMatView = {
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

type PgDdlStatement = {
  ordinal: number
  category: string
  destructive: boolean
  sql: string
}

type PgDdlPreview = {
  executionMode: string
  statementCount: number
  statements: PgDdlStatement[]
  transactionMode: string
  safeGuards?: string[]
  lockTargets?: string[]
}

type PgWarning = {
  warningCode: string
  severity: string
  category: string
  summary: string
  impactLevel: string
  requiresAcknowledgement: boolean
  detail?: string
}

type PgRiskProfile = {
  riskLevel: string
  statementCount: number
  lockTargetCount: number
  blockingLikely: boolean
  destructive: boolean
  acknowledgementRequired: boolean
}

type CollectionOf<T> = {
  items?: T[]
  page?: {
    total?: number
  }
}

type SectionState<T> = {
  data: T
  loading: boolean
  error: string | null
}

type DdlPreviewTarget = {
  kind: 'table' | 'view' | 'matview'
  name: string
}

type DdlPreviewState = {
  data: PgDdlPreview | null
  warnings: PgWarning[]
  riskProfile: PgRiskProfile | null
  loading: boolean
  error: string | null
}

type PgMutationAccepted = {
  ddlPreview?: PgDdlPreview
  preExecutionWarnings?: PgWarning[]
  riskProfile?: PgRiskProfile
}

const EMPTY_COLLECTION_STATE = <T,>(data: T): SectionState<T> => ({
  data,
  loading: false,
  error: null
})

const EMPTY_DDL_PREVIEW: DdlPreviewState = {
  data: null,
  warnings: [],
  riskProfile: null,
  loading: false,
  error: null
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function createPageQuery(): string {
  return new URLSearchParams({ 'page[size]': '100' }).toString()
}

async function loadDatabases(): Promise<CollectionOf<PgDatabase>> {
  return requestConsoleSessionJson<CollectionOf<PgDatabase>>(`/v1/postgres/databases?${createPageQuery()}`)
}

async function loadSchemas(databaseName: string): Promise<CollectionOf<PgSchema>> {
  return requestConsoleSessionJson<CollectionOf<PgSchema>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas?${createPageQuery()}`
  )
}

async function loadTables(databaseName: string, schemaName: string): Promise<CollectionOf<PgTable>> {
  return requestConsoleSessionJson<CollectionOf<PgTable>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/tables?${createPageQuery()}`
  )
}

async function loadColumns(databaseName: string, schemaName: string, tableName: string): Promise<CollectionOf<PgColumn>> {
  return requestConsoleSessionJson<CollectionOf<PgColumn>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/tables/${encodePathSegment(tableName)}/columns?${createPageQuery()}`
  )
}

async function loadIndexes(databaseName: string, schemaName: string, tableName: string): Promise<CollectionOf<PgIndex>> {
  return requestConsoleSessionJson<CollectionOf<PgIndex>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/tables/${encodePathSegment(tableName)}/indexes?${createPageQuery()}`
  )
}

async function loadPolicies(databaseName: string, schemaName: string, tableName: string): Promise<CollectionOf<PgPolicy>> {
  return requestConsoleSessionJson<CollectionOf<PgPolicy>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/tables/${encodePathSegment(tableName)}/policies?${createPageQuery()}`
  )
}

async function loadSecurity(databaseName: string, schemaName: string, tableName: string): Promise<PgSecurity> {
  return requestConsoleSessionJson<PgSecurity>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/tables/${encodePathSegment(tableName)}/security`
  )
}

async function loadViews(databaseName: string, schemaName: string): Promise<CollectionOf<PgView>> {
  return requestConsoleSessionJson<CollectionOf<PgView>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/views?${createPageQuery()}`
  )
}

async function loadMatViews(databaseName: string, schemaName: string): Promise<CollectionOf<PgMatView>> {
  return requestConsoleSessionJson<CollectionOf<PgMatView>>(
    `/v1/postgres/databases/${encodePathSegment(databaseName)}/schemas/${encodePathSegment(schemaName)}/materialized-views?${createPageQuery()}`
  )
}

function formatLabel(value?: string | null): string {
  if (!value) {
    return '—'
  }

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getRiskTone(value?: string | null): string {
  switch (value) {
    case 'critical':
      return 'border-red-500/40 bg-red-500/10 text-red-300'
    case 'high':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-300'
    case 'medium':
      return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
    case 'low':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    default:
      return 'border-border bg-muted text-foreground'
  }
}

function getWarningClass(severity?: string | null): string {
  switch (severity) {
    case 'critical':
      return 'warning-critical border-red-500/40 bg-red-500/10'
    case 'high':
      return 'warning-high border-orange-500/40 bg-orange-500/10'
    case 'medium':
      return 'warning-medium border-yellow-500/40 bg-yellow-500/10'
    case 'low':
      return 'warning-low border-emerald-500/40 bg-emerald-500/10'
    default:
      return 'warning-info border-border bg-muted/60'
  }
}

function truncateText(value?: string, length = 60): string {
  if (!value) {
    return '—'
  }

  if (value.length <= length) {
    return value
  }

  return `${value.slice(0, length)}…`
}

function isActiveRow(selected: boolean): string {
  return selected ? 'bg-muted' : 'hover:bg-muted/60'
}

export function ConsolePostgresPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId ?? null)
  const previousWorkspaceIdRef = useRef<string | null>(activeWorkspaceId ?? null)

  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null)
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableDetailTab, setTableDetailTab] = useState<'columns' | 'indexes' | 'policies' | 'security'>('columns')
  const [schemaTab, setSchemaTab] = useState<'tables' | 'views' | 'matviews'>('tables')

  const [databases, setDatabases] = useState<SectionState<PgDatabase[]>>(EMPTY_COLLECTION_STATE([]))
  const [schemas, setSchemas] = useState<SectionState<PgSchema[]>>(EMPTY_COLLECTION_STATE([]))
  const [tables, setTables] = useState<SectionState<PgTable[]>>(EMPTY_COLLECTION_STATE([]))
  const [columns, setColumns] = useState<SectionState<PgColumn[]>>(EMPTY_COLLECTION_STATE([]))
  const [indexes, setIndexes] = useState<SectionState<PgIndex[]>>(EMPTY_COLLECTION_STATE([]))
  const [policies, setPolicies] = useState<SectionState<PgPolicy[]>>(EMPTY_COLLECTION_STATE([]))
  const [security, setSecurity] = useState<SectionState<PgSecurity | null>>(EMPTY_COLLECTION_STATE<PgSecurity | null>(null))
  const [views, setViews] = useState<SectionState<PgView[]>>(EMPTY_COLLECTION_STATE([]))
  const [matViews, setMatViews] = useState<SectionState<PgMatView[]>>(EMPTY_COLLECTION_STATE([]))

  const [ddlPreviewOpen, setDdlPreviewOpen] = useState(false)
  const [databaseWizardOpen, setDatabaseWizardOpen] = useState(false)
  const [ddlPreviewTarget, setDdlPreviewTarget] = useState<DdlPreviewTarget | null>(null)
  const [ddlPreview, setDdlPreview] = useState<DdlPreviewState>(EMPTY_DDL_PREVIEW)

  const selectedDatabaseRecord = useMemo(
    () => databases.data.find((database) => database.databaseName === selectedDatabase) ?? null,
    [databases.data, selectedDatabase]
  )

  const postgresSnippetContext = useMemo<SnippetContext | null>(() => {
    if (!selectedDatabase) {
      return null
    }

    const databaseState = selectedDatabaseRecord?.state ?? null

    return {
      tenantId: activeTenantId,
      tenantSlug: activeTenant?.secondary ?? null,
      workspaceId: activeWorkspaceId,
      workspaceSlug: activeWorkspace?.secondary ?? null,
      resourceName: selectedDatabase,
      resourceHost: null,
      resourcePort: 5432,
      resourceExtraA: selectedSchema,
      resourceExtraB: null,
      resourceState: databaseState,
      externalAccessEnabled: databaseState === 'active'
    }
  }, [activeTenant?.secondary, activeTenantId, activeWorkspace?.secondary, activeWorkspaceId, selectedDatabase, selectedDatabaseRecord?.state, selectedSchema])

  const resetSchemaAndBelow = useCallback(() => {
    setSelectedSchema(null)
    setSelectedTable(null)
    setSchemaTab('tables')
    setTableDetailTab('columns')
    setSchemas(EMPTY_COLLECTION_STATE([]))
    setTables(EMPTY_COLLECTION_STATE([]))
    setColumns(EMPTY_COLLECTION_STATE([]))
    setIndexes(EMPTY_COLLECTION_STATE([]))
    setPolicies(EMPTY_COLLECTION_STATE([]))
    setSecurity(EMPTY_COLLECTION_STATE<PgSecurity | null>(null))
    setViews(EMPTY_COLLECTION_STATE([]))
    setMatViews(EMPTY_COLLECTION_STATE([]))
    setDdlPreviewOpen(false)
    setDdlPreviewTarget(null)
    setDdlPreview(EMPTY_DDL_PREVIEW)
  }, [])

  const resetTableDetail = useCallback(() => {
    setSelectedTable(null)
    setTableDetailTab('columns')
    setColumns(EMPTY_COLLECTION_STATE([]))
    setIndexes(EMPTY_COLLECTION_STATE([]))
    setPolicies(EMPTY_COLLECTION_STATE([]))
    setSecurity(EMPTY_COLLECTION_STATE<PgSecurity | null>(null))
    setDdlPreviewOpen(false)
    setDdlPreviewTarget(null)
    setDdlPreview(EMPTY_DDL_PREVIEW)
  }, [])

  const reloadDatabases = useCallback(async () => {
    setDatabases((current) => ({ ...current, loading: true, error: null }))

    try {
      const response = await loadDatabases()
      setDatabases({ data: response.items ?? [], loading: false, error: null })
    } catch (error) {
      setDatabases({ data: [], loading: false, error: describeConsoleError(error, 'No se pudieron cargar las bases de datos PostgreSQL.') })
    }
  }, [])

  const reloadSchemas = useCallback(async (databaseName: string) => {
    setSchemas((current) => ({ ...current, loading: true, error: null }))

    try {
      const response = await loadSchemas(databaseName)
      setSchemas({ data: response.items ?? [], loading: false, error: null })
    } catch (error) {
      setSchemas({ data: [], loading: false, error: describeConsoleError(error, 'No se pudieron cargar los esquemas PostgreSQL.') })
    }
  }, [])

  const reloadTablesViewsAndMatViews = useCallback(async (databaseName: string, schemaName: string) => {
    setTables((current) => ({ ...current, loading: true, error: null }))
    setViews((current) => ({ ...current, loading: true, error: null }))
    setMatViews((current) => ({ ...current, loading: true, error: null }))

    const [tablesResult, viewsResult, matViewsResult] = await Promise.allSettled([
      loadTables(databaseName, schemaName),
      loadViews(databaseName, schemaName),
      loadMatViews(databaseName, schemaName)
    ])

    if (tablesResult.status === 'fulfilled') {
      setTables({ data: tablesResult.value.items ?? [], loading: false, error: null })
    } else {
      setTables({ data: [], loading: false, error: describeConsoleError(tablesResult.reason, 'No se pudieron cargar las tablas del esquema.') })
    }

    if (viewsResult.status === 'fulfilled') {
      setViews({ data: viewsResult.value.items ?? [], loading: false, error: null })
    } else {
      setViews({ data: [], loading: false, error: describeConsoleError(viewsResult.reason, 'No se pudieron cargar las vistas del esquema.') })
    }

    if (matViewsResult.status === 'fulfilled') {
      setMatViews({ data: matViewsResult.value.items ?? [], loading: false, error: null })
    } else {
      setMatViews({ data: [], loading: false, error: describeConsoleError(matViewsResult.reason, 'No se pudieron cargar las vistas materializadas del esquema.') })
    }
  }, [])

  const reloadTableDetail = useCallback(async (databaseName: string, schemaName: string, tableName: string) => {
    setColumns((current) => ({ ...current, loading: true, error: null }))
    setIndexes((current) => ({ ...current, loading: true, error: null }))
    setPolicies((current) => ({ ...current, loading: true, error: null }))
    setSecurity((current) => ({ ...current, loading: true, error: null }))

    const [columnsResult, indexesResult, policiesResult, securityResult] = await Promise.allSettled([
      loadColumns(databaseName, schemaName, tableName),
      loadIndexes(databaseName, schemaName, tableName),
      loadPolicies(databaseName, schemaName, tableName),
      loadSecurity(databaseName, schemaName, tableName)
    ])

    if (columnsResult.status === 'fulfilled') {
      setColumns({ data: columnsResult.value.items ?? [], loading: false, error: null })
    } else {
      setColumns({ data: [], loading: false, error: describeConsoleError(columnsResult.reason, 'No se pudieron cargar las columnas de la tabla.') })
    }

    if (indexesResult.status === 'fulfilled') {
      setIndexes({ data: indexesResult.value.items ?? [], loading: false, error: null })
    } else {
      setIndexes({ data: [], loading: false, error: describeConsoleError(indexesResult.reason, 'No se pudieron cargar los índices de la tabla.') })
    }

    if (policiesResult.status === 'fulfilled') {
      setPolicies({ data: policiesResult.value.items ?? [], loading: false, error: null })
    } else {
      setPolicies({ data: [], loading: false, error: describeConsoleError(policiesResult.reason, 'No se pudieron cargar las políticas RLS de la tabla.') })
    }

    if (securityResult.status === 'fulfilled') {
      setSecurity({ data: securityResult.value, loading: false, error: null })
    } else {
      setSecurity({ data: null, loading: false, error: describeConsoleError(securityResult.reason, 'No se pudo cargar la seguridad efectiva de la tabla.') })
    }
  }, [])

  const openDdlPreview = useCallback(
    async (kind: 'table' | 'view' | 'matview', name: string) => {
      if (!activeTenantId || !activeWorkspaceId || !selectedDatabase || !selectedSchema) {
        setDdlPreviewOpen(true)
        setDdlPreviewTarget({ kind, name })
        setDdlPreview({ ...EMPTY_DDL_PREVIEW, error: 'Selecciona organización, área de trabajo, base de datos y esquema antes de pedir el preview DDL.' })
        return
      }

      setDdlPreviewOpen(true)
      setDdlPreviewTarget({ kind, name })
      setDdlPreview({ ...EMPTY_DDL_PREVIEW, loading: true })

      try {
        let response: PgMutationAccepted

        if (kind === 'table') {
          // El family file expone `executionMode` y `dryRun` en el payload del recurso; usamos `PUT` con preview para obtener `ddlPreview` sin ejecutar la mutación.
          response = await requestConsoleSessionJson<PgMutationAccepted>(
            `/v1/postgres/databases/${encodePathSegment(selectedDatabase)}/schemas/${encodePathSegment(selectedSchema)}/tables/${encodePathSegment(name)}`,
            {
              method: 'PUT',
              body: {
                tenantId: activeTenantId,
                workspaceId: activeWorkspaceId,
                databaseName: selectedDatabase,
                schemaName: selectedSchema,
                tableName: name,
                dryRun: true,
                executionMode: 'preview'
              } as never
            }
          )
        } else if (kind === 'view') {
          const view = views.data.find((item) => item.viewName === name)
          if (!view?.query) {
            throw new Error('La API no devolvió el `query` de la vista y no se puede construir un preview seguro.')
          }

          response = await requestConsoleSessionJson<PgMutationAccepted>(
            `/v1/postgres/databases/${encodePathSegment(selectedDatabase)}/schemas/${encodePathSegment(selectedSchema)}/views/${encodePathSegment(name)}`,
            {
              method: 'PUT',
              body: {
                tenantId: activeTenantId,
                workspaceId: activeWorkspaceId,
                databaseName: selectedDatabase,
                schemaName: selectedSchema,
                viewName: name,
                query: view.query,
                columns: view.columns,
                securityBarrier: view.securityBarrier,
                dryRun: true,
                executionMode: 'preview'
              } as never
            }
          )
        } else {
          const matView = matViews.data.find((item) => item.viewName === name)
          if (!matView?.query) {
            throw new Error('La API no devolvió el `query` de la vista materializada y no se puede construir un preview seguro.')
          }

          response = await requestConsoleSessionJson<PgMutationAccepted>(
            `/v1/postgres/databases/${encodePathSegment(selectedDatabase)}/schemas/${encodePathSegment(selectedSchema)}/materialized-views/${encodePathSegment(name)}`,
            {
              method: 'PUT',
              body: {
                tenantId: activeTenantId,
                workspaceId: activeWorkspaceId,
                databaseName: selectedDatabase,
                schemaName: selectedSchema,
                viewName: name,
                query: matView.query,
                columns: matView.columns,
                withData: matView.withData,
                refreshPolicy: matView.refreshPolicy,
                dryRun: true,
                executionMode: 'preview'
              } as never
            }
          )
        }

        if (!response.ddlPreview) {
          throw new Error('El servidor no devolvió ddlPreview para esta operación en modo preview.')
        }

        setDdlPreview({
          data: response.ddlPreview,
          warnings: response.preExecutionWarnings ?? [],
          riskProfile: response.riskProfile ?? null,
          loading: false,
          error: null
        })
      } catch (error) {
        setDdlPreview({
          data: null,
          warnings: [],
          riskProfile: null,
          loading: false,
          error: describeConsoleError(error, 'No se pudo generar el preview DDL del recurso seleccionado.')
        })
      }
    },
    [activeTenantId, activeWorkspaceId, matViews.data, selectedDatabase, selectedSchema, views.data]
  )

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId ?? null
  }, [activeWorkspaceId])

  useEffect(() => {
    const controller = new AbortController()
    previousWorkspaceIdRef.current = activeWorkspaceIdRef.current

    setSelectedDatabase(null)
    resetSchemaAndBelow()
    setDatabases(EMPTY_COLLECTION_STATE([]))

    if (!activeTenantId) {
      return () => {
        controller.abort()
      }
    }

    void (async () => {
      setDatabases((current) => ({ ...current, loading: true, error: null }))
      try {
        const response = await loadDatabases()
        if (!controller.signal.aborted) {
          setDatabases({ data: response.items ?? [], loading: false, error: null })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setDatabases({ data: [], loading: false, error: describeConsoleError(error, 'No se pudieron cargar las bases de datos PostgreSQL.') })
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [activeTenantId, resetSchemaAndBelow])

  useEffect(() => {
    const controller = new AbortController()

    resetSchemaAndBelow()

    if (!selectedDatabase || !activeWorkspaceIdRef.current) {
      return () => {
        controller.abort()
      }
    }

    void (async () => {
      setSchemas((current) => ({ ...current, loading: true, error: null }))
      try {
        const response = await loadSchemas(selectedDatabase)
        if (!controller.signal.aborted) {
          setSchemas({ data: response.items ?? [], loading: false, error: null })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSchemas({ data: [], loading: false, error: describeConsoleError(error, 'No se pudieron cargar los esquemas PostgreSQL.') })
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [resetSchemaAndBelow, selectedDatabase])

  useEffect(() => {
    const controller = new AbortController()

    resetTableDetail()
    setSchemaTab('tables')
    setTables(EMPTY_COLLECTION_STATE([]))
    setViews(EMPTY_COLLECTION_STATE([]))
    setMatViews(EMPTY_COLLECTION_STATE([]))

    if (!selectedDatabase || !selectedSchema) {
      return () => {
        controller.abort()
      }
    }

    void (async () => {
      setTables((current) => ({ ...current, loading: true, error: null }))
      setViews((current) => ({ ...current, loading: true, error: null }))
      setMatViews((current) => ({ ...current, loading: true, error: null }))

      const [tablesResult, viewsResult, matViewsResult] = await Promise.allSettled([
        loadTables(selectedDatabase, selectedSchema),
        loadViews(selectedDatabase, selectedSchema),
        loadMatViews(selectedDatabase, selectedSchema)
      ])

      if (controller.signal.aborted) {
        return
      }

      if (tablesResult.status === 'fulfilled') {
        setTables({ data: tablesResult.value.items ?? [], loading: false, error: null })
      } else {
        setTables({ data: [], loading: false, error: describeConsoleError(tablesResult.reason, 'No se pudieron cargar las tablas del esquema.') })
      }

      if (viewsResult.status === 'fulfilled') {
        setViews({ data: viewsResult.value.items ?? [], loading: false, error: null })
      } else {
        setViews({ data: [], loading: false, error: describeConsoleError(viewsResult.reason, 'No se pudieron cargar las vistas del esquema.') })
      }

      if (matViewsResult.status === 'fulfilled') {
        setMatViews({ data: matViewsResult.value.items ?? [], loading: false, error: null })
      } else {
        setMatViews({ data: [], loading: false, error: describeConsoleError(matViewsResult.reason, 'No se pudieron cargar las vistas materializadas del esquema.') })
      }
    })()

    return () => {
      controller.abort()
    }
  }, [resetTableDetail, selectedDatabase, selectedSchema])

  useEffect(() => {
    const controller = new AbortController()

    setColumns(EMPTY_COLLECTION_STATE([]))
    setIndexes(EMPTY_COLLECTION_STATE([]))
    setPolicies(EMPTY_COLLECTION_STATE([]))
    setSecurity(EMPTY_COLLECTION_STATE<PgSecurity | null>(null))
    setDdlPreviewOpen(false)
    setDdlPreviewTarget(null)
    setDdlPreview(EMPTY_DDL_PREVIEW)
    setTableDetailTab('columns')

    if (!selectedDatabase || !selectedSchema || !selectedTable) {
      return () => {
        controller.abort()
      }
    }

    void (async () => {
      setColumns((current) => ({ ...current, loading: true, error: null }))
      setIndexes((current) => ({ ...current, loading: true, error: null }))
      setPolicies((current) => ({ ...current, loading: true, error: null }))
      setSecurity((current) => ({ ...current, loading: true, error: null }))

      const [columnsResult, indexesResult, policiesResult, securityResult] = await Promise.allSettled([
        loadColumns(selectedDatabase, selectedSchema, selectedTable),
        loadIndexes(selectedDatabase, selectedSchema, selectedTable),
        loadPolicies(selectedDatabase, selectedSchema, selectedTable),
        loadSecurity(selectedDatabase, selectedSchema, selectedTable)
      ])

      if (controller.signal.aborted) {
        return
      }

      if (columnsResult.status === 'fulfilled') {
        setColumns({ data: columnsResult.value.items ?? [], loading: false, error: null })
      } else {
        setColumns({ data: [], loading: false, error: describeConsoleError(columnsResult.reason, 'No se pudieron cargar las columnas de la tabla.') })
      }

      if (indexesResult.status === 'fulfilled') {
        setIndexes({ data: indexesResult.value.items ?? [], loading: false, error: null })
      } else {
        setIndexes({ data: [], loading: false, error: describeConsoleError(indexesResult.reason, 'No se pudieron cargar los índices de la tabla.') })
      }

      if (policiesResult.status === 'fulfilled') {
        setPolicies({ data: policiesResult.value.items ?? [], loading: false, error: null })
      } else {
        setPolicies({ data: [], loading: false, error: describeConsoleError(policiesResult.reason, 'No se pudieron cargar las políticas RLS de la tabla.') })
      }

      if (securityResult.status === 'fulfilled') {
        setSecurity({ data: securityResult.value, loading: false, error: null })
      } else {
        setSecurity({ data: null, loading: false, error: describeConsoleError(securityResult.reason, 'No se pudo cargar la seguridad efectiva de la tabla.') })
      }
    })()

    return () => {
      controller.abort()
    }
  }, [selectedDatabase, selectedSchema, selectedTable])

  useEffect(() => {
    const controller = new AbortController()
    const previousWorkspaceId = previousWorkspaceIdRef.current
    previousWorkspaceIdRef.current = activeWorkspaceId ?? null

    if (!selectedDatabase || !activeWorkspaceId || previousWorkspaceId === activeWorkspaceId) {
      return () => {
        controller.abort()
      }
    }

    setSelectedSchema(null)
    setSelectedTable(null)
    setSchemaTab('tables')
    setTableDetailTab('columns')
    setTables(EMPTY_COLLECTION_STATE([]))
    setColumns(EMPTY_COLLECTION_STATE([]))
    setIndexes(EMPTY_COLLECTION_STATE([]))
    setPolicies(EMPTY_COLLECTION_STATE([]))
    setSecurity(EMPTY_COLLECTION_STATE<PgSecurity | null>(null))
    setViews(EMPTY_COLLECTION_STATE([]))
    setMatViews(EMPTY_COLLECTION_STATE([]))
    setDdlPreviewOpen(false)
    setDdlPreviewTarget(null)
    setDdlPreview(EMPTY_DDL_PREVIEW)

    void (async () => {
      setSchemas((current) => ({ ...current, loading: true, error: null }))
      try {
        const response = await loadSchemas(selectedDatabase)
        if (!controller.signal.aborted) {
          setSchemas({ data: response.items ?? [], loading: false, error: null })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSchemas({ data: [], loading: false, error: describeConsoleError(error, 'No se pudieron cargar los esquemas PostgreSQL.') })
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [activeWorkspaceId, selectedDatabase])

  const headerDescription = useMemo(() => {
    if (!activeTenantId) {
      return 'Selecciona una organización para explorar las bases de datos PostgreSQL.'
    }

    if (!activeWorkspaceId) {
      return 'Selecciona un área de trabajo para ver esquemas, tablas, vistas y la seguridad efectiva del dominio relacional.'
    }

    return 'Explora bases de datos, esquemas, tablas, vistas, políticas RLS y previews DDL sin capacidad de escritura.'
  }, [activeTenantId, activeWorkspaceId])

  return (
    <section className="space-y-6" aria-label="PostgreSQL de la organización activa">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">PostgreSQL</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inventario relacional de la organización activa</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{headerDescription}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Organización: {activeTenant?.label ?? 'Sin organización'}</Badge>
            <Badge variant="secondary">Área de trabajo: {activeWorkspace?.label ?? 'Sin área de trabajo'}</Badge>
            <Button type="button" onClick={() => setDatabaseWizardOpen(true)}>Nueva base de datos</Button>
          </div>
        </div>
      </header>

      {databaseWizardOpen ? <ProvisionDatabaseWizard open={databaseWizardOpen} onOpenChange={setDatabaseWizardOpen} defaultEngine="postgresql" /> : null}

      <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-postgres-breadcrumb-heading">
        <div className="space-y-4">
          <div>
            <h2 id="console-postgres-breadcrumb-heading" className="text-lg font-semibold text-foreground">
              Navegación PostgreSQL
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Recorre la jerarquía base de datos → esquema → tabla o vista.</p>
          </div>

          <nav aria-label="Navegación PostgreSQL" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto rounded-md px-2 py-1 font-normal hover:bg-muted"
              onClick={() => setSelectedDatabase(null)}
            >
              Bases de datos
            </Button>
            {selectedDatabase ? (
              <>
                <span aria-hidden="true">›</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto rounded-md px-2 py-1 font-normal hover:bg-muted"
                  onClick={() => setSelectedSchema(null)}
                >
                  {selectedDatabase}
                </Button>
              </>
            ) : null}
            {selectedSchema ? (
              <>
                <span aria-hidden="true">›</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto rounded-md px-2 py-1 font-normal hover:bg-muted"
                  onClick={() => setSelectedTable(null)}
                >
                  {selectedSchema}
                </Button>
              </>
            ) : null}
            {selectedTable ? (
              <>
                <span aria-hidden="true">›</span>
                <span className="rounded-md bg-muted px-2 py-1 text-foreground">{selectedTable}</span>
              </>
            ) : null}
          </nav>
        </div>
      </section>

      {!activeTenantId ? (
        <ConsoleEmptyState message="Selecciona una organización para explorar las bases de datos PostgreSQL." />
      ) : null}

      {activeTenantId ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-postgres-databases-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="console-postgres-databases-heading" className="text-lg font-semibold text-foreground">
                Bases de datos
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Bases de datos PostgreSQL visibles para la organización activa.</p>
            </div>
            {databases.error ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void reloadDatabases()}>
                Reintentar
              </Button>
            ) : null}
          </div>

          {databases.loading ? <ConsoleSectionLoading label="Cargando bases de datos PostgreSQL…" /> : null}
          {!databases.loading && databases.error ? (
            <ConsoleSectionError message={databases.error} actionLabel="Reintentar" onRetry={() => void reloadDatabases()} />
          ) : null}
          {!databases.loading && !databases.error && databases.data.length === 0 ? (
            <ConsoleSectionEmpty message="No hay bases de datos disponibles para esta organización." />
          ) : null}
          {!databases.loading && !databases.error && databases.data.length > 0 ? (
            <Table containerClassName="mt-4" aria-label="Listado de bases de datos PostgreSQL">
              <TableHeader>
                <TableRow>
                  <TableHead>Base de datos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Propietario</TableHead>
                  <TableHead>Ubicación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {databases.data.map((database) => (
                  <TableRow
                    key={database.databaseName}
                    className={`cursor-pointer ${isActiveRow(selectedDatabase === database.databaseName)}`}
                    onClick={() => setSelectedDatabase(database.databaseName)}
                  >
                    <TableCell className="font-medium text-foreground">{database.databaseName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{formatLabel(database.state)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{database.ownerRoleName}</TableCell>
                    <TableCell className="text-muted-foreground">{formatLabel(database.placementMode)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </section>
      ) : null}

      {selectedDatabase ? (
        <>
          {postgresSnippetContext ? <ConnectionSnippets resourceType="postgres-database" context={postgresSnippetContext} /> : null}
          <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-postgres-schemas-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="console-postgres-schemas-heading" className="text-lg font-semibold text-foreground">
                Esquemas de {selectedDatabase}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Selecciona un esquema para inspeccionar tablas, vistas y vistas materializadas.</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedDatabase(null)}>
                ← Volver
              </Button>
              {schemas.error ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void reloadSchemas(selectedDatabase)}>
                  Reintentar
                </Button>
              ) : null}
            </div>
          </div>

          {!activeWorkspaceId ? (
            <div className="mt-4">
              <WorkspaceRequiredState description="Selecciona un área de trabajo para ver esquemas." />
            </div>
          ) : null}
          {activeWorkspaceId && schemas.loading ? <ConsoleSectionLoading label="Cargando esquemas PostgreSQL…" /> : null}
          {activeWorkspaceId && !schemas.loading && schemas.error ? (
            <ConsoleSectionError message={schemas.error} actionLabel="Reintentar" onRetry={() => void reloadSchemas(selectedDatabase)} />
          ) : null}
          {activeWorkspaceId && !schemas.loading && !schemas.error && schemas.data.length === 0 ? (
            <ConsoleSectionEmpty message="No hay esquemas visibles para el área de trabajo activa en esta base de datos." />
          ) : null}
          {activeWorkspaceId && !schemas.loading && !schemas.error && schemas.data.length > 0 ? (
            <Table containerClassName="mt-4" aria-label="Listado de esquemas PostgreSQL del área de trabajo activa">
              <TableHeader>
                <TableRow>
                  <TableHead>Esquema</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Propietario</TableHead>
                  <TableHead>Conteos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schemas.data.map((schema) => (
                  <TableRow
                    key={schema.schemaName}
                    className={`cursor-pointer ${isActiveRow(selectedSchema === schema.schemaName)}`}
                    onClick={() => setSelectedSchema(schema.schemaName)}
                  >
                    <TableCell className="font-medium text-foreground">{schema.schemaName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{formatLabel(schema.state)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{schema.ownerRoleName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {schema.objectCounts
                        ? `${schema.objectCounts.tables} tablas · ${schema.objectCounts.views} vistas · ${schema.objectCounts.materializedViews} materializadas · ${schema.objectCounts.indexes} índices`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </section>
        </>
      ) : null}

      {selectedSchema ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-postgres-schema-detail-heading">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="console-postgres-schema-detail-heading" className="text-lg font-semibold text-foreground">
                  Esquema {selectedSchema}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Explora tablas, vistas y vistas materializadas del esquema seleccionado.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant={schemaTab === 'tables' ? 'default' : 'outline'} size="sm" onClick={() => setSchemaTab('tables')}>
                  Tablas
                </Button>
                <Button type="button" variant={schemaTab === 'views' ? 'default' : 'outline'} size="sm" onClick={() => setSchemaTab('views')}>
                  Vistas
                </Button>
                <Button type="button" variant={schemaTab === 'matviews' ? 'default' : 'outline'} size="sm" onClick={() => setSchemaTab('matviews')}>
                  Vistas materializadas
                </Button>
              </div>
            </div>

            {schemaTab === 'tables' ? (
              <div role="tabpanel" aria-label="Tablas PostgreSQL del esquema seleccionado">
                {tables.loading ? <ConsoleSectionLoading label="Cargando tablas PostgreSQL…" /> : null}
                {!tables.loading && tables.error ? (
                  <ConsoleSectionError
                    message={tables.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema) {
                        void reloadTablesViewsAndMatViews(selectedDatabase, selectedSchema)
                      }
                    }}
                  />
                ) : null}
                {!tables.loading && !tables.error && tables.data.length === 0 ? <ConsoleSectionEmpty message="Este esquema no tiene tablas definidas." /> : null}
                {!tables.loading && !tables.error && tables.data.length > 0 ? (
                  <Table aria-label="Listado de tablas PostgreSQL del esquema seleccionado">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tabla</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Columnas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tables.data.map((table) => (
                        <TableRow
                          key={table.tableName}
                          className={`cursor-pointer ${isActiveRow(selectedTable === table.tableName)}`}
                          onClick={() => setSelectedTable(table.tableName)}
                        >
                          <TableCell className="font-medium text-foreground">{table.tableName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{formatLabel(table.state)}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{table.columnCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ) : null}

            {schemaTab === 'views' ? (
              <div role="tabpanel" aria-label="Vistas PostgreSQL del esquema seleccionado">
                {views.loading ? <ConsoleSectionLoading label="Cargando vistas PostgreSQL…" /> : null}
                {!views.loading && views.error ? (
                  <ConsoleSectionError
                    message={views.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema) {
                        void reloadTablesViewsAndMatViews(selectedDatabase, selectedSchema)
                      }
                    }}
                  />
                ) : null}
                {!views.loading && !views.error && views.data.length === 0 ? <ConsoleSectionEmpty message="Este esquema no tiene vistas definidas." /> : null}
                {!views.loading && !views.error && views.data.length > 0 ? (
                  <Table aria-label="Listado de vistas PostgreSQL del esquema seleccionado">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vista</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Columnas</TableHead>
                        <TableHead>Barrera de seguridad</TableHead>
                        <TableHead className="text-right">Vista previa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {views.data.map((view) => (
                        <TableRow key={view.viewName} className="hover:bg-muted/60">
                          <TableCell className="font-medium text-foreground">{view.viewName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{formatLabel(view.state)}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{view.columns?.join(', ') || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">
                            <Badge variant="secondary">{view.securityBarrier ? 'Sí' : 'No'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" onClick={() => void openDdlPreview('view', view.viewName)}>
                              Vista previa DDL
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ) : null}

            {schemaTab === 'matviews' ? (
              <div role="tabpanel" aria-label="Vistas materializadas PostgreSQL del esquema seleccionado">
                {matViews.loading ? <ConsoleSectionLoading label="Cargando vistas materializadas PostgreSQL…" /> : null}
                {!matViews.loading && !matViews.error && matViews.data.length === 0 ? (
                  <ConsoleSectionEmpty message="Este esquema no tiene vistas materializadas definidas." />
                ) : null}
                {!matViews.loading && matViews.error ? (
                  <ConsoleSectionError
                    message={matViews.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema) {
                        void reloadTablesViewsAndMatViews(selectedDatabase, selectedSchema)
                      }
                    }}
                  />
                ) : null}
                {!matViews.loading && !matViews.error && matViews.data.length > 0 ? (
                  <Table aria-label="Listado de vistas materializadas PostgreSQL del esquema seleccionado">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vista materializada</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Con datos</TableHead>
                        <TableHead>Política de refresh</TableHead>
                        <TableHead>Integridad</TableHead>
                        <TableHead className="text-right">Vista previa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matViews.data.map((view) => (
                        <TableRow key={view.viewName} className="hover:bg-muted/60">
                          <TableCell className="font-medium text-foreground">{view.viewName}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{formatLabel(view.state)}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <Badge variant="secondary">{view.withData ? 'Sí' : 'No'}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{view.refreshPolicy || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{view.integrityProfile?.populationState || '—'}</TableCell>
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" onClick={() => void openDdlPreview('matview', view.viewName)}>
                              Vista previa DDL
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedTable ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-postgres-table-detail-heading">
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="console-postgres-table-detail-heading" className="text-lg font-semibold text-foreground">
                  Tabla {selectedTable}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Detalle de solo lectura de columnas, índices, políticas y seguridad efectiva.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant={tableDetailTab === 'columns' ? 'default' : 'outline'} size="sm" onClick={() => setTableDetailTab('columns')}>
                  Columnas
                </Button>
                <Button type="button" variant={tableDetailTab === 'indexes' ? 'default' : 'outline'} size="sm" onClick={() => setTableDetailTab('indexes')}>
                  Índices
                </Button>
                <Button type="button" variant={tableDetailTab === 'policies' ? 'default' : 'outline'} size="sm" onClick={() => setTableDetailTab('policies')}>
                  Políticas
                </Button>
                <Button type="button" variant={tableDetailTab === 'security' ? 'default' : 'outline'} size="sm" onClick={() => setTableDetailTab('security')}>
                  Seguridad
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void openDdlPreview('table', selectedTable)}>
                  Vista previa DDL
                </Button>
              </div>
            </div>

            {tableDetailTab === 'columns' ? (
              <div role="tabpanel" aria-label="Columnas de la tabla seleccionada">
                {columns.loading ? <ConsoleSectionLoading label="Cargando columnas…" /> : null}
                {!columns.loading && columns.error ? (
                  <ConsoleSectionError
                    message={columns.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema && selectedTable) {
                        void reloadTableDetail(selectedDatabase, selectedSchema, selectedTable)
                      }
                    }}
                  />
                ) : null}
                {!columns.loading && !columns.error && columns.data.length === 0 ? (
                  <ConsoleSectionEmpty message="Esta tabla no tiene columnas definidas." />
                ) : null}
                {!columns.loading && !columns.error && columns.data.length > 0 ? (
                  <Table aria-label="Listado de columnas de la tabla seleccionada">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Columna</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Nullable</TableHead>
                        <TableHead>Default</TableHead>
                        <TableHead>Posición</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {columns.data.map((column) => (
                        <TableRow key={column.columnName}>
                          <TableCell className="font-medium text-foreground">{column.columnName}</TableCell>
                          <TableCell className="text-muted-foreground">{column.dataType?.typeName || 'desconocido'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{column.nullable ? 'NULL' : 'NOT NULL'}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{column.defaultExpression || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{column.ordinalPosition ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ) : null}

            {tableDetailTab === 'indexes' ? (
              <div role="tabpanel" aria-label="Índices de la tabla seleccionada">
                {indexes.loading ? <ConsoleSectionLoading label="Cargando índices…" /> : null}
                {!indexes.loading && indexes.error ? (
                  <ConsoleSectionError
                    message={indexes.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema && selectedTable) {
                        void reloadTableDetail(selectedDatabase, selectedSchema, selectedTable)
                      }
                    }}
                  />
                ) : null}
                {!indexes.loading && !indexes.error && indexes.data.length === 0 ? (
                  <ConsoleSectionEmpty message="Esta tabla no tiene índices definidos." />
                ) : null}
                {!indexes.loading && !indexes.error && indexes.data.length > 0 ? (
                  <Table aria-label="Listado de índices de la tabla seleccionada">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Índice</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead>Unicidad</TableHead>
                        <TableHead>Keys</TableHead>
                        <TableHead>Include</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {indexes.data.map((index) => (
                        <TableRow key={index.indexName}>
                          <TableCell className="font-medium text-foreground">{index.indexName}</TableCell>
                          <TableCell className="text-muted-foreground">{index.indexMethod}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{index.unique ? 'Único' : '—'}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {index.keys?.map((key) => key.columnName || key.expression || '—').join(', ') || '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{index.includeColumns?.join(', ') || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ) : null}

            {tableDetailTab === 'policies' ? (
              <div role="tabpanel" aria-label="Políticas de la tabla seleccionada">
                {policies.loading ? <ConsoleSectionLoading label="Cargando políticas…" /> : null}
                {!policies.loading && policies.error ? (
                  <ConsoleSectionError
                    message={policies.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema && selectedTable) {
                        void reloadTableDetail(selectedDatabase, selectedSchema, selectedTable)
                      }
                    }}
                  />
                ) : null}
                {!policies.loading && !policies.error && policies.data.length === 0 ? (
                  <ConsoleSectionEmpty
                    message={
                      security.data?.rlsEnabled === false ? 'RLS deshabilitado — no hay políticas.' : 'No hay políticas definidas.'
                    }
                  />
                ) : null}
                {!policies.loading && !policies.error && policies.data.length > 0 ? (
                  <Table aria-label="Listado de políticas de la tabla seleccionada">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy</TableHead>
                        <TableHead>Modo</TableHead>
                        <TableHead>Command</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead>Using</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policies.data.map((policy) => (
                        <TableRow key={policy.policyName}>
                          <TableCell className="font-medium text-foreground">{policy.policyName}</TableCell>
                          <TableCell className="text-muted-foreground">{formatLabel(policy.policyMode)}</TableCell>
                          <TableCell className="text-muted-foreground">{policy.appliesTo?.command?.toUpperCase() || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{policy.appliesTo?.roles?.join(', ') || '(todos los roles)'}</TableCell>
                          <TableCell className="text-muted-foreground">{truncateText(policy.usingExpression)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
              </div>
            ) : null}

            {tableDetailTab === 'security' ? (
              <div role="tabpanel" aria-label="Seguridad de la tabla seleccionada">
                {security.loading ? <ConsoleSectionLoading label="Cargando seguridad efectiva…" /> : null}
                {!security.loading && security.error ? (
                  <ConsoleSectionError
                    message={security.error}
                    actionLabel="Reintentar"
                    onRetry={() => {
                      if (selectedDatabase && selectedSchema && selectedTable) {
                        void reloadTableDetail(selectedDatabase, selectedSchema, selectedTable)
                      }
                    }}
                  />
                ) : null}
                {!security.loading && !security.error && !security.data ? (
                  <ConsoleSectionEmpty message="Información de seguridad no disponible." />
                ) : null}
                {!security.loading && !security.error && security.data ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <SecurityCard label="RLS habilitado" value={security.data.rlsEnabled ? 'Sí' : 'No'} tone={security.data.rlsEnabled ? 'positive' : 'negative'} />
                    <SecurityCard label="Forzar RLS" value={security.data.forceRls ? 'Sí' : 'No'} tone={security.data.forceRls ? 'positive' : 'neutral'} />
                    <SecurityCard label="Cantidad de políticas" value={String(security.data.policyCount ?? 0)} tone="neutral" />
                    <SecurityCard label="Clasificación compartida" value={formatLabel(security.data.sharedTableClassification)} tone="neutral" />
                    <SecurityCard label="Estado" value={formatLabel(security.data.state)} tone="neutral" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {ddlPreviewOpen ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-postgres-ddl-preview-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="console-postgres-ddl-preview-heading" className="text-lg font-semibold text-foreground">
                Vista previa DDL — {ddlPreviewTarget?.name ?? 'recurso'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Panel estrictamente de solo lectura. No existe acción de ejecución en esta vista.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setDdlPreviewOpen(false)}>
              Cerrar
            </Button>
          </div>

          {ddlPreview.loading ? <ConsoleSectionLoading label="Generando vista previa DDL…" /> : null}
          {!ddlPreview.loading && ddlPreview.error ? (
            <ConsoleSectionError
              message={ddlPreview.error}
              actionLabel="Reintentar"
              onRetry={() => {
                if (ddlPreviewTarget) {
                  void openDdlPreview(ddlPreviewTarget.kind, ddlPreviewTarget.name)
                }
              }}
            />
          ) : null}

          {!ddlPreview.loading && !ddlPreview.error && ddlPreview.riskProfile ? (
            <div className="mt-4 rounded-2xl border border-border bg-background/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={getRiskTone(ddlPreview.riskProfile.riskLevel)} variant="outline">
                  {formatLabel(ddlPreview.riskProfile.riskLevel)}
                </Badge>
                <Badge variant="secondary">Sentencias: {ddlPreview.riskProfile.statementCount}</Badge>
                <Badge variant="secondary">Bloqueos: {ddlPreview.riskProfile.lockTargetCount}</Badge>
                <Badge variant="secondary">Destructivo: {ddlPreview.riskProfile.destructive ? 'Sí' : 'No'}</Badge>
                <Badge variant="secondary">Bloqueo probable: {ddlPreview.riskProfile.blockingLikely ? 'Sí' : 'No'}</Badge>
                <Badge variant="secondary">Confirmación requerida: {ddlPreview.riskProfile.acknowledgementRequired ? 'Sí' : 'No'}</Badge>
              </div>
            </div>
          ) : null}

          {!ddlPreview.loading && !ddlPreview.error && ddlPreview.warnings.length > 0 ? (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Advertencias previas a la ejecución</h3>
              {ddlPreview.warnings.map((warning) => (
                <div
                  key={warning.warningCode}
                  data-severity={warning.severity}
                  className={`rounded-2xl border p-4 ${getWarningClass(warning.severity)}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={getRiskTone(warning.severity)} variant="outline">
                      {formatLabel(warning.severity)}
                    </Badge>
                    <Badge variant="secondary">{formatLabel(warning.category)}</Badge>
                    <Badge variant="secondary">Confirmación: {warning.requiresAcknowledgement ? 'Sí' : 'No'}</Badge>
                  </div>
                  <p className="mt-3 font-medium text-foreground">{warning.summary}</p>
                  {warning.detail ? <p className="mt-1 text-sm text-muted-foreground">{warning.detail}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {!ddlPreview.loading && !ddlPreview.error && ddlPreview.data ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Modo de ejecución: {formatLabel(ddlPreview.data.executionMode)}</Badge>
                <Badge variant="secondary">Transacción: {formatLabel(ddlPreview.data.transactionMode)}</Badge>
                <Badge variant="secondary">Sentencias: {ddlPreview.data.statementCount}</Badge>
              </div>

              {ddlPreview.data.safeGuards?.length ? (
                <div className="rounded-2xl border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Salvaguardas</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {ddlPreview.data.safeGuards.map((guard) => (
                      <li key={guard}>{guard}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {ddlPreview.data.lockTargets?.length ? (
                <div className="rounded-2xl border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Lock targets</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ddlPreview.data.lockTargets.map((target) => (
                      <Badge key={target} variant="outline">
                        {target}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3">
                {ddlPreview.data.statements.map((statement) => (
                  <article key={`${statement.ordinal}-${statement.category}`} className="rounded-2xl border border-border bg-background/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">#{statement.ordinal}</Badge>
                      <Badge variant="outline">{formatLabel(statement.category)}</Badge>
                      <Badge variant="secondary">Destructivo: {statement.destructive ? 'Sí' : 'No'}</Badge>
                    </div>
                    <pre className="mt-3 overflow-x-auto rounded-xl bg-muted/70 p-4 text-sm">
                      <code className="font-mono text-sm">{statement.sql}</code>
                    </pre>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  )
}

function ConsoleEmptyState({ message }: { message: string }) {
  return (
    <section className="rounded-3xl border border-dashed border-border bg-card/40 p-10 text-center shadow-sm">
      <p className="text-base font-medium text-foreground">{message}</p>
    </section>
  )
}

function ConsoleSectionLoading({ label }: { label: string }) {
  return <p className="mt-4 text-sm text-muted-foreground">{label}</p>
}

function ConsoleSectionEmpty({ message }: { message: string }) {
  return <p className="mt-4 rounded-2xl border border-dashed border-border bg-background/40 px-4 py-6 text-sm text-muted-foreground">{message}</p>
}

function ConsoleSectionError({
  message,
  actionLabel,
  onRetry
}: {
  message: string
  actionLabel: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
      <p>{message}</p>
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

function SecurityCard({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone: 'positive' | 'negative' | 'neutral'
}) {
  const toneClass =
    tone === 'positive'
      ? 'border-emerald-500/40 bg-emerald-500/10'
      : tone === 'negative'
        ? 'border-red-500/40 bg-red-500/10'
        : 'border-border bg-background/40'

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}
