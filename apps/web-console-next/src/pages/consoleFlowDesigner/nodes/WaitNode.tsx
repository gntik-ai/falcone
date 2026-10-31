import { useCopy } from '../copy'
// Canvas node for the DSL `wait` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Clock } from 'lucide-react'

import { NodeShell } from './NodeShell'
import type { FlowCanvasNodeData } from '../flowGraphModel'
import type { WaitNode as WaitDslNode } from '../flows'

export function WaitNode({ data, selected }: NodeProps) {
  const { t, i18n } = useCopy()
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as WaitDslNode
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel={t('nodeTypes.wait')}
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
