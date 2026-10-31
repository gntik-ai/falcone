import { useCopy } from '../copy'
// Canvas node for the DSL `task` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'

import { NodeShell } from './NodeShell'
import type { FlowCanvasNodeData } from '../flowGraphModel'
import type { TaskNode as TaskDslNode } from '../flows'

export function TaskNode({ data, selected }: NodeProps) {
  const { t, i18n } = useCopy()
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as TaskDslNode
  const badges: string[] = [dsl.taskType]
  if (dsl.retryPolicy?.maxAttempts !== undefined) {
    badges.push(t('retryBadge', { count: dsl.retryPolicy.maxAttempts }))
  }
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel={t('nodeTypes.task')}
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
