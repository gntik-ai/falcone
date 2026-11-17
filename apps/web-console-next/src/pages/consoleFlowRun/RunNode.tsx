// Read-only run-mode canvas node (copied from the legacy RunNode, on kit tokens).
//
// A single node type: the node card plus the run-status tag. All visible text arrives
// translated in the node data, so this file stays presentational and free of i18n imports.
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { StatusTag, Text, type StatusTagProps } from '@gntik-ai/ui'
import type { FlowCanvasNodeData } from './flowGraphModel'

export interface RunNodeData extends FlowCanvasNodeData {
  typeLabel: string
  pendingLabel: string
  // Present once the node has a status: the translated label, its tone and the attempt/duration text.
  status: null | { key: string; label: string; tone: NonNullable<StatusTagProps['statuses']>[string]['tone']; detail: string }
}

export function RunNode({ data, selected }: NodeProps) {
  const node = data as RunNodeData
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div data-testid="flow-node-shell" className={`relative min-w-44 max-w-64 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}>
        <Text variant="caption" tone="muted" className="block font-semibold">{node.typeLabel}</Text>
        <Text variant="body" tone="default" truncate={true} className="mt-1 block font-medium" title={node.label}>{node.label}</Text>
        <div className="mt-2">
          {node.status
            ? <span className="inline-flex flex-wrap items-center gap-1" data-testid="node-status-badge" data-status={node.status.key}>
              <StatusTag status={node.status.key} label={node.status.label} statuses={{ [node.status.key]: { label: node.status.label, tone: node.status.tone } }} uppercase={false} />
              {node.status.detail && <Text variant="caption" tone="muted" data-testid="node-status-detail">{node.status.detail}</Text>}
            </span>
            : <Text variant="caption" tone="muted" data-testid="run-node-pending">{node.pendingLabel}</Text>}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="next" isConnectable={false} />
    </>
  )
}

export const runNodeTypes = { run: RunNode }
