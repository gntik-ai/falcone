// Canvas node for the DSL `task` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { TaskNode as TaskDslNode } from '@/types/flows'

export function TaskNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as TaskDslNode
  const badges: string[] = [dsl.taskType]
  if (dsl.retryPolicy?.maxAttempts !== undefined) {
    badges.push(`retry ×${dsl.retryPolicy.maxAttempts}`)
  }
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Task"
        label={nodeData.label}
        icon={Box}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={badges}
      />
      <Handle type="source" position={Position.Bottom} id="next" />
    </>
  )
}
