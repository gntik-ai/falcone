// Flow list page (change: add-console-flow-designer).
//
// Lists the active workspace's flows and creates new drafts, then hands off to the
// canvas designer at /console/flows/:flowId. Lazy-loaded from router.tsx so the
// @xyflow/react chunk stays out of the initial shell bundle.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CapabilityGate } from '@/components/console/CapabilityGate'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConsoleContext } from '@/lib/console-context'
import { createFlowDraft, listFlows, type FlowSummary } from '@/services/flowsApi'

function formatTimestamp(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ConsoleFlowsPage() {
  const navigate = useNavigate()
  const { activeWorkspaceId } = useConsoleContext()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newFlowName, setNewFlowName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return
    setLoading(true)
    setLoadError(null)
    try {
      const response = await listFlows(activeWorkspaceId)
      setFlows(response.items ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load flows')
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const onCreate = async () => {
    if (!activeWorkspaceId || !newFlowName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createFlowDraft(activeWorkspaceId, { name: newFlowName.trim() })
      navigate(`/console/flows/${encodeURIComponent(created.flowId)}`)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create the flow draft')
      setCreating(false)
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="space-y-2 p-6">
        <h1 className="text-xl font-semibold">Flows</h1>
        <p className="text-sm text-muted-foreground">
          Select a workspace to manage its flows.
        </p>
      </section>
    )
  }

  return (
    <CapabilityGate capability="workflows" mode="disable">
      <section className="space-y-4 p-6" data-testid="console-flows-page">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Badge variant="outline">Workflows</Badge>
            <h1 className="mt-1 text-xl font-semibold">Flows</h1>
            <p className="text-sm text-muted-foreground">
              Visual workflow definitions for workspace <span className="font-mono">{activeWorkspaceId}</span>.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Input
                placeholder="New flow name"
                value={newFlowName}
                onChange={(event) => setNewFlowName(event.target.value)}
                data-testid="new-flow-name-input"
              />
            </div>
            <Button onClick={() => void onCreate()} disabled={creating || newFlowName.trim() === ''}>
              {creating ? 'Creating…' : 'New flow'}
            </Button>
          </div>
        </header>

        {createError ? <p className="text-sm text-destructive">{createError}</p> : null}

        {loading ? (
          <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />
        ) : loadError ? (
          <div className="space-y-2 rounded-lg border border-destructive/40 p-4 text-sm">
            <p className="text-destructive">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : flows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            No flows yet. Create the first one to open the designer.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last modified</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {flows.map((flow) => (
                  <tr key={flow.flowId} className="border-t border-border" data-testid="flow-row">
                    <td className="px-3 py-2 font-medium">{flow.name}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {flow.status ?? 'draft'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatTimestamp(flow.updatedAt ?? flow.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/console/flows/${encodeURIComponent(flow.flowId)}`)}
                      >
                        Open designer
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </CapabilityGate>
  )
}
