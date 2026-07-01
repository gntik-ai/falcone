// Canvas node for the DSL `approval` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { UserCheck } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { ApprovalNode as ApprovalDslNode } from '@/types/flows'

export function ApprovalNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as ApprovalDslNode
  const badges: string[] = []
  if (dsl.approvers?.length) badges.push(`${dsl.approvers.length} aprobador${dsl.approvers.length === 1 ? '' : 'es'}`)
  if (dsl.timeout) badges.push(`timeout ${dsl.timeout}`)
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Aprobación"
        label={nodeData.label}
        icon={UserCheck}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={badges}
      />
      <Handle type="source" position={Position.Bottom} id="next" />
    </>
  )
}
