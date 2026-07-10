import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { CapabilityGate } from '@/components/console/CapabilityGate'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { RealtimeSnippetsPanel } from '@/components/console/snippets/RealtimeSnippetsPanel'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError } from '@/lib/console-errors'
import { requestConsoleSessionJson } from '@/lib/console-session'

type WorkspaceRealtimeResponse = {
  workspaceId: string
  realtimeEndpointUrl?: string | null
  features?: { realtime?: boolean }
  dataSources?: Array<{ type?: string | null }>
}

function mapChannelTypes(dataSources: WorkspaceRealtimeResponse['dataSources']): string[] {
  return Array.from(new Set((dataSources ?? []).flatMap((source) => {
    if (source?.type === 'postgresql') return ['postgresql-changes']
    if (source?.type == 'mongodb') return ['mongodb-changes']
    return []
  })))
}

export function ConsoleRealtimePage() {
  const params = useParams<{ workspaceId: string }>()
  const { activeWorkspaceId } = useConsoleContext()
  const workspaceId = params.workspaceId ?? activeWorkspaceId ?? ''
  const [data, setData] = useState<WorkspaceRealtimeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await requestConsoleSessionJson<WorkspaceRealtimeResponse>(`/v1/workspaces/${workspaceId}/realtime`)
        if (!cancelled) {
          setData(response)
        }
      } catch (err) {
        if (!cancelled) {
          setError(describeConsoleError(err, 'No se pudo cargar la configuración realtime del área de trabajo.'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    if (workspaceId) {
      void load()
    } else {
      setError('No hay un área de trabajo seleccionada.')
      setLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [reloadToken, workspaceId])

  const channelTypes = useMemo(() => mapChannelTypes(data?.dataSources), [data?.dataSources])

  if (loading) {
    return (
      <section className="space-y-4">
        <div
          data-testid="realtime-loading-skeleton"
          role="status"
          aria-label="Cargando configuración en tiempo real"
          aria-busy="true"
          className="h-24 animate-pulse rounded-3xl border border-border bg-muted/40"
        />
      </section>
    )
  }

  if (error) {
    return (
      <section className="space-y-4">
        <ConsolePageState
          kind="error"
          title="Error al cargar metadatos realtime del área de trabajo"
          description={error}
          actionLabel="Reintentar"
          onAction={() => setReloadToken((value) => value + 1)}
        />
      </section>
    )
  }

  return (
    <CapabilityGate capability="realtime" mode="disable">
      <section className="space-y-6">
        <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tiempo real del área de trabajo</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ejemplos de suscripción en tiempo real para navegador y servidor.</p>
        </header>
        <RealtimeSnippetsPanel
          workspaceId={workspaceId}
          realtimeEndpoint={data?.realtimeEndpointUrl ?? null}
          channelTypes={channelTypes}
          realtimeEnabled={data?.features?.realtime === true}
        />
      </section>
    </CapabilityGate>
  )
}

export { mapChannelTypes }
