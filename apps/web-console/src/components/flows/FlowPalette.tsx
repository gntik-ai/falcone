// Task-type palette for the flow designer (change: add-console-flow-designer).
//
// Driven ENTIRELY by the server task-type catalog (taskTypeRegistryApi.listTaskTypes);
// no task type is hard-coded here. Entries are grouped by descriptor `category` and use
// the standard @xyflow/react drag-to-canvas pattern (dataTransfer payload consumed by
// ConsoleFlowDesignerPage's onDrop).
import { useCallback, useEffect, useState } from 'react'
import type { DragEvent } from 'react'

import { Button } from '@/components/ui/button'
import { listTaskTypes } from '@/services/taskTypeRegistryApi'
import type { TaskTypeDescriptor } from '@/types/flows'

export const FLOW_PALETTE_DRAG_MIME = 'application/x-falcone-flow-task-type'

interface FlowPaletteProps {
  workspaceId: string
  onCatalogLoaded?: (taskTypes: TaskTypeDescriptor[]) => void
}

type PaletteState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; items: TaskTypeDescriptor[] }

export function FlowPalette({ workspaceId, onCatalogLoaded }: FlowPaletteProps) {
  const [state, setState] = useState<PaletteState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const items = await listTaskTypes(workspaceId)
      setState({ phase: 'ready', items })
      onCatalogLoaded?.(items)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar los tipos de tarea.'
      setState({ phase: 'error', message })
    }
  }, [workspaceId, onCatalogLoaded])

  useEffect(() => {
    void load()
  }, [load])

  const onDragStart = (event: DragEvent<HTMLDivElement>, descriptor: TaskTypeDescriptor) => {
    event.dataTransfer.setData(FLOW_PALETTE_DRAG_MIME, JSON.stringify(descriptor))
    event.dataTransfer.effectAllowed = 'move'
  }

  if (state.phase === 'loading') {
    return (
      <div data-testid="flow-palette-loading" className="space-y-2 p-3">
        <div className="h-8 animate-pulse rounded-md bg-muted/60" />
        <div className="h-8 animate-pulse rounded-md bg-muted/60" />
        <div className="h-8 animate-pulse rounded-md bg-muted/60" />
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div data-testid="flow-palette-error" className="space-y-2 p-3 text-sm">
        <p className="text-destructive">No se pudo cargar el catálogo de tipos de tarea.</p>
        <p className="text-xs text-muted-foreground">{state.message}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    )
  }

  const byCategory = new Map<string, TaskTypeDescriptor[]>()
  for (const descriptor of state.items) {
    const category = descriptor.category || 'other'
    const list = byCategory.get(category) ?? []
    list.push(descriptor)
    byCategory.set(category, list)
  }

  return (
    <div data-testid="flow-palette" className="space-y-3 overflow-y-auto p-3">
      {[...byCategory.entries()].map(([category, descriptors]) => (
        <div key={category}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {category}
          </div>
          <div className="space-y-1">
            {descriptors.map((descriptor) => (
              <div
                key={descriptor.id}
                draggable
                data-testid={`flow-palette-item-${descriptor.id}`}
                onDragStart={(event) => onDragStart(event, descriptor)}
                className="cursor-grab rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm hover:border-primary/50 active:cursor-grabbing"
                title={descriptor.id}
              >
                {descriptor.label}
              </div>
            ))}
          </div>
        </div>
      ))}
      {state.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">El catálogo de tipos de tarea está vacío.</p>
      ) : null}
    </div>
  )
}
