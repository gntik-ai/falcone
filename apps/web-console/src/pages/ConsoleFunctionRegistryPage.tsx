import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { ApiError } from '@/lib/http'

interface FunctionRecord {
  id: string
  workspace_id: string
  name: string
  runtime: string
  handler: string | null
  source_ref: string | null
  runtime_status: string
  status: string
  created_at: string
}

interface ListResponse {
  items: FunctionRecord[]
  total: number
}

function errMsg(error: unknown, fallback: string): string {
  return (error as Partial<ApiError>)?.message?.trim() || fallback
}

export function ConsoleFunctionRegistryPage() {
  const { activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const [items, setItems] = useState<FunctionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState('nodejs:20')
  const [handler, setHandler] = useState('main')

  const load = useCallback(async (workspaceId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await requestConsoleSessionJson<ListResponse>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/functions`)
      setItems(res.items ?? [])
    } catch (rawError) {
      setError(errMsg(rawError, 'No se pudieron cargar las funciones del workspace.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId) {
      setItems([])
      setError(null)
      return
    }
    void load(activeWorkspaceId)
  }, [activeWorkspaceId, load])

  async function register(event: FormEvent) {
    event.preventDefault()
    if (!activeWorkspaceId || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await requestConsoleSessionJson(`/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/functions`, {
        method: 'POST',
        body: { name: name.trim(), runtime: runtime.trim() || 'nodejs:20', handler: handler.trim() || 'main' }
      })
      setName('')
      await load(activeWorkspaceId)
    } catch (rawError) {
      setError(errMsg(rawError, 'No se pudo registrar la función.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="space-y-6" data-testid="console-function-registry-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="space-y-2">
          <Badge variant="outline">Functions</Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Registro de funciones</h1>
          <p className="text-sm text-muted-foreground">
            Registra funciones serverless para el workspace activo. La ejecución se activa cuando el plano de datos
            OpenWhisk esté desplegado (estado <code className="rounded bg-muted px-1 py-0.5">pending_data_plane</code>).
          </p>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          Workspace activo: {activeWorkspace?.label ?? 'Sin workspace seleccionado'}
        </div>
      </header>

      {!activeWorkspaceId ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            Selecciona un tenant y un workspace en la barra superior para gestionar sus funciones.
          </p>
        </section>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {activeWorkspaceId ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Registrar función</h2>
          <form className="mt-4 grid gap-4 sm:grid-cols-3" onSubmit={register}>
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Nombre</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="on-user-created"
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Runtime</span>
              <input
                value={runtime}
                onChange={(event) => setRuntime(event.target.value)}
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Handler</span>
              <input
                value={handler}
                onChange={(event) => setHandler(event.target.value)}
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Registrando…' : 'Registrar función'}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {activeWorkspaceId ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Funciones registradas</h2>
          {loading ? (
            <p className="mt-2 text-sm text-muted-foreground">Cargando funciones…</p>
          ) : items.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Aún no hay funciones registradas en este workspace.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {items.map((fn) => (
                <li key={fn.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{fn.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {fn.runtime} · handler {fn.handler ?? 'main'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{fn.status}</Badge>
                    <Badge variant="outline">{fn.runtime_status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  )
}
