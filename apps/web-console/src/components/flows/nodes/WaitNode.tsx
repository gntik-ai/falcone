// Canvas node for the DSL `wait` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Clock } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { WaitNode as WaitDslNode } from '@/types/flows'

export function WaitNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as WaitDslNode
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Espera"
        label={nodeData.label}
        icon={Clock}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={dsl.duration ? [dsl.duration] : []}
      />
      <Handle type="source" position={Position.Bottom} id="next" />
    </>
  )
}
