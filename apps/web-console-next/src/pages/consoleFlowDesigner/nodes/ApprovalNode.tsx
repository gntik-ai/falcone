import { useCopy } from '../copy'
// Canvas node for the DSL `approval` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { UserCheck } from 'lucide-react'

import { NodeShell } from './NodeShell'
import type { FlowCanvasNodeData } from '../flowGraphModel'
import type { ApprovalNode as ApprovalDslNode } from '../flows'

export function ApprovalNode({ data, selected }: NodeProps) {
  const { t, i18n } = useCopy()
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as ApprovalDslNode
  const badges: string[] = []
  if (dsl.approvers?.length) badges.push(t('approversBadge', { count: dsl.approvers.length }))
  if (dsl.timeout) badges.push(t('timeoutBadge', { duration: dsl.timeout }))
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel={t('nodeTypes.approval')}
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
