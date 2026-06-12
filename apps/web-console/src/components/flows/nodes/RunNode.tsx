// Read-only run-mode canvas node (change: add-console-flow-monitoring / #366).
//
// A single node type used by the run view: it wraps the shared NodeShell with the per-node
// run-status badge overlay (status / attempt / duration). It is non-interactive (no editable
// handles beyond the connection anchors needed to draw the same edges). Clicking it selects the
// node so the run page can open the detail panel.
import { Handle, Position, type NodeProps } from '@xyflow/react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import { NodeStatusBadge } from '@/components/flows/NodeStatusBadge'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { NodeStatusSnapshot } from '@/lib/hooks/use-flow-execution'

export interface RunNodeData extends FlowCanvasNodeData {
  runStatus?: NodeStatusSnapshot | null
  typeLabel: string
}

export function RunNode({ data, selected }: NodeProps) {
  const nodeData = data as RunNodeData
  const runStatus = nodeData.runStatus ?? null
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <NodeShell typeLabel={nodeData.typeLabel} label={nodeData.label} selected={selected}>
        {runStatus ? (
          <div className="mt-2">
            <NodeStatusBadge
              status={runStatus.status}
              attemptNumber={runStatus.attemptNumber}
              startedAt={runStatus.startedAt}
              completedAt={runStatus.completedAt}
            />
          </div>
        ) : (
          <div className="mt-2 text-[10px] text-muted-foreground" data-testid="run-node-pending">
            pending
          </div>
        )}
      </NodeShell>
      <Handle type="source" position={Position.Bottom} id="next" isConnectable={false} />
    </>
  )
}

export const runNodeTypes = { run: RunNode }
