// Canvas node for the DSL `sub-flow` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Workflow } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { SubFlowNode as SubFlowDslNode } from '@/types/flows'

export function SubFlowNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as SubFlowDslNode
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Sub-flow"
        label={nodeData.label}
        icon={Workflow}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={[`${dsl.flowId}@${dsl.flowVersion}`]}
      />
      <Handle type="source" position={Position.Bottom} id="next" />
    </>
  )
}
