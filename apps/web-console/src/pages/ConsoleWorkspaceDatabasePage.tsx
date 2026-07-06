import { useCallback, useEffect, useState } from 'react'

import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError } from '@/lib/console-errors'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { ApiError } from '@/lib/http'

interface WorkspaceDatabaseRecord {
  id: string
  workspace_id: string
  tenant_id: string
  database_name: string
  engine: string
  mode: string
  username: string
  host: string
  port: number
  status: string
  created_at: string
}

interface DatabaseConnection {
  mode: string
  engine: string
  database: string
  host: string
  port: number
  username: string
  password: string | null
  passwordHint: string | null
  dsn: string
  sslmode: string
}

interface ProvisionResponse {
  database: WorkspaceDatabaseRecord
  connection: DatabaseConnection
  sagaId?: string
}

interface GetResponse {
  database: WorkspaceDatabaseRecord
}

interface RotateResponse {
  databaseId: string
  rotated: boolean
  reason?: string
  mode?: string
  database?: string
  username?: string
  password?: string
  dsn?: string
}

export function ConsoleWorkspaceDatabasePage() {
  const { activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const [record, setRecord] = useState<WorkspaceDatabaseRecord | null>(null)
  const [connection, setConnection] = useState<DatabaseConnection | null>(null)
  const [rotation, setRotation] = useState<RotateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notProvisioned, setNotProvisioned] = useState(false)

  const load = useCallback(async (workspaceId: string) => {
    setLoading(true)
    setError(null)
    setNotProvisioned(false)
    setConnection(null)
    setRotation(null)
    try {
      const res = await requestConsoleSessionJson<GetResponse>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/database`)
      setRecord(res.database)
    } catch (rawError) {
      if ((rawError as Partial<ApiError>)?.status === 404) {
        setRecord(null)
        setNotProvisioned(true)
      } else {
        setError(describeConsoleError(rawError, 'No se pudo cargar la base de datos del área de trabajo.'))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId) {
      setRecord(null)
      setNotProvisioned(false)
      setConnection(null)
      setRotation(null)
      setError(null)
      return
    }
    void load(activeWorkspaceId)
  }, [activeWorkspaceId, load])

  async function provision() {
    if (!activeWorkspaceId) return
    setBusy(true)
    setError(null)
    try {
      const res = await requestConsoleSessionJson<ProvisionResponse>(
        `/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/database`,
        { method: 'POST', body: {} }
      )
      setRecord(res.database)
      setConnection(res.connection)
      setNotProvisioned(false)
    } catch (rawError) {
      setError(describeConsoleError(rawError, 'No se pudo aprovisionar la base de datos del área de trabajo.'))
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    if (!activeWorkspaceId) return
    setBusy(true)
    setError(null)
    try {
      // Dedicated-credential rotation -> 201 with the new DSN/password (rendered below). A
      // shared-mode workspace has no dedicated credential to rotate and now returns a non-success
      // 409 DB_SHARED_MODE (#686) instead of a misleading 200 {rotated:false}; that lands in catch.
      const res = await requestConsoleSessionJson<RotateResponse>(
        `/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/database/credential-rotations`,
        { method: 'POST', body: {} }
      )
      setRotation(res)
    } catch (rawError) {
      // Clear any stale rotation panel. DB_SHARED_MODE is a known, console-owned code with its
      // own copy (#743's narrow allow-list) — handled directly so the generic 409 mapping below
      // never overrides it. Anything else (including an unrecognized code on the same 409)
      // routes through the shared, never-raw helper.
      setRotation(null)
      if ((rawError as Partial<ApiError>)?.code === 'DB_SHARED_MODE') {
        setError('Esta área de trabajo usa la credencial compartida de la plataforma; no hay una credencial dedicada que rotar.')
      } else {
        setError(describeConsoleError(rawError, 'No se pudo rotar la credencial de base de datos.'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="space-y-6" data-testid="console-workspace-database-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Base de datos del área de trabajo</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Base de datos del área de trabajo</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Aprovisiona y gestiona una base de datos PostgreSQL dedicada (aislamiento a nivel de catálogo) para el
                área de trabajo activa.
              </p>
            </div>
          </div>
          {record ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void rotate()}>
              {busy ? 'Procesando…' : 'Rotar credencial'}
            </Button>
          ) : null}
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          Área de trabajo activa: {activeWorkspace?.label ?? 'Sin área de trabajo seleccionada'}
        </div>
      </header>

      {!activeWorkspaceId ? <WorkspaceRequiredState description="Selecciona un área de trabajo para aprovisionar y gestionar su base de datos." /> : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {activeWorkspaceId && loading ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">Cargando estado de la base de datos…</p>
        </section>
      ) : null}

      {activeWorkspaceId && !loading && notProvisioned && !record ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Sin base de datos aprovisionada</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área de trabajo todavía no tiene una base de datos. Al aprovisionarla se crea una base PostgreSQL real con
            <code className="mx-1 rounded bg-muted px-1 py-0.5">CONNECT</code> revocado para <code>PUBLIC</code>.
          </p>
          <Button type="button" className="mt-4" disabled={busy} onClick={() => void provision()}>
            {busy ? 'Aprovisionando…' : 'Aprovisionar base de datos'}
          </Button>
        </section>
      ) : null}

      {record ? (
        <section className="space-y-4 rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Base de datos aprovisionada</h2>
            <div className="flex gap-2">
              <Badge variant="secondary">{record.engine}</Badge>
              <Badge variant={record.mode === 'dedicated_role' ? 'default' : 'outline'}>{record.mode}</Badge>
              <Badge variant="outline">{record.status}</Badge>
            </div>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Base de datos" value={record.database_name} mono />
            <Field label="Servidor" value={record.host} mono />
            <Field label="Puerto" value={String(record.port)} mono />
            <Field label="Usuario" value={record.username} mono />
          </dl>
        </section>
      ) : null}

      {connection ? (
        <section className="space-y-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Credencial de conexión</h2>
          <p className="text-sm text-muted-foreground">
            {connection.password
              ? 'Guarda esta contraseña: se muestra una sola vez.'
              : connection.passwordHint ?? 'Esta base reutiliza la credencial de plataforma (modo compartido).'}
          </p>
          <CodeBlock text={connection.dsn} />
          {connection.password ? <CodeBlock text={`password: ${connection.password}`} /> : null}
        </section>
      ) : null}

      {rotation ? (
        <section className="space-y-3 rounded-3xl border border-amber-500/30 bg-amber-500/5 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Rotación de credencial</h2>
          {rotation.rotated ? (
            <>
              <p className="text-sm text-muted-foreground">Nueva credencial generada (se muestra una sola vez).</p>
              {rotation.dsn ? <CodeBlock text={rotation.dsn} /> : null}
              {rotation.password ? <CodeBlock text={`password: ${rotation.password}`} /> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{rotation.reason ?? 'No había credencial dedicada que rotar.'}</p>
          )}
        </section>
      ) : null}
    </main>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-1 break-all font-mono text-sm text-foreground' : 'mt-1 text-sm text-foreground'}>{value}</dd>
    </div>
  )
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-background/80 px-4 py-3 font-mono text-xs text-foreground">
      {text}
    </pre>
  )
}
