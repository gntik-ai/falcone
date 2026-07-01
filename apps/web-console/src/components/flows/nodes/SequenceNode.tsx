// Canvas node for the DSL `sequence` construct (change: add-console-flow-designer).
//
// Not listed as a palette construct, but definitions may contain sequences, so the
// canvas renders them with the same chrome. `steps` edges leave through the bottom
// `steps` handle; the post-sequence `next` edge through the right-hand `next` handle.
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ListOrdered } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { SequenceNode as SequenceDslNode } from '@/types/flows'

export function SequenceNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as SequenceDslNode
  const stepCount = dsl.steps?.length ?? 0
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Secuencia"
        label={nodeData.label}
        icon={ListOrdered}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={[`${stepCount} step${stepCount === 1 ? '' : 's'}`]}
      />
      <Handle type="source" position={Position.Bottom} id="steps" />
      <Handle type="source" position={Position.Right} id="next" />
    </>
  )
}
