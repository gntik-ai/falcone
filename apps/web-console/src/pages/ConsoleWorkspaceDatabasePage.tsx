import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
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

function errMsg(error: unknown, fallback: string): string {
  return (error as Partial<ApiError>)?.message?.trim() || fallback
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
        setError(errMsg(rawError, 'No se pudo cargar la base de datos del workspace.'))
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
      setError(errMsg(rawError, 'No se pudo aprovisionar la base de datos del workspace.'))
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    if (!activeWorkspaceId) return
    setBusy(true)
    setError(null)
    try {
      const res = await requestConsoleSessionJson<RotateResponse>(
        `/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/database/credential-rotations`,
        { method: 'POST', body: {} }
      )
      setRotation(res)
    } catch (rawError) {
      setError(errMsg(rawError, 'No se pudo rotar la credencial de base de datos.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="space-y-6" data-testid="console-workspace-database-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Workspace database</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Base de datos del workspace</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Aprovisiona y gestiona una base de datos PostgreSQL dedicada (aislamiento a nivel de catálogo) para el
                workspace activo.
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
          Workspace activo: {activeWorkspace?.label ?? 'Sin workspace seleccionado'}
        </div>
      </header>

      {!activeWorkspaceId ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            Selecciona un tenant y un workspace en la barra superior para gestionar su base de datos.
          </p>
        </section>
      ) : null}

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
            Este workspace todavía no tiene una base de datos. Al aprovisionarla se crea una base PostgreSQL real con
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
            <Field label="Database" value={record.database_name} mono />
            <Field label="Host" value={record.host} mono />
            <Field label="Port" value={String(record.port)} mono />
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
