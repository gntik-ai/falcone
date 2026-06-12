// Canvas node for the DSL `branch` construct (change: add-console-flow-designer).
//
// Renders ONE labelled source handle per condition arm (id `arm-<index>`, matching the
// edge sourceHandle convention in flowGraphModel.ts) plus one `default` handle.
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranch } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { BranchNode as BranchDslNode } from '@/types/flows'

export function BranchNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as BranchDslNode
  const arms = dsl.arms ?? []
  // Spread the arm handles plus the default handle evenly along the bottom edge.
  const handleCount = arms.length + 1
  const handleLeft = (index: number) => `${((index + 1) / (handleCount + 1)) * 100}%`
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Branch"
        label={nodeData.label}
        icon={GitBranch}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={[`${arms.length} arm${arms.length === 1 ? '' : 's'}`]}
      >
        <div className="mt-1 space-y-0.5">
          {arms.map((arm, index) => (
            <div
              key={`arm-${index}`}
              className="truncate font-mono text-[10px] text-muted-foreground"
              title={arm.when}
            >
              {index + 1}. {arm.when}
            </div>
          ))}
        </div>
      </NodeShell>
      {arms.map((_, index) => (
        <Handle
          key={`arm-${index}`}
          type="source"
          position={Position.Bottom}
          id={`arm-${index}`}
          style={{ left: handleLeft(index) }}
        />
      ))}
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
        style={{ left: handleLeft(arms.length) }}
      />
    </>
  )
}
