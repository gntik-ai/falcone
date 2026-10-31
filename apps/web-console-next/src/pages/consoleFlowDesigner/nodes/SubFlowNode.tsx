import { useCopy } from '../copy'
// Canvas node for the DSL `sub-flow` construct (change: add-console-flow-designer).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Workflow } from 'lucide-react'

import { NodeShell } from './NodeShell'
import type { FlowCanvasNodeData } from '../flowGraphModel'
import type { SubFlowNode as SubFlowDslNode } from '../flows'

export function SubFlowNode({ data, selected }: NodeProps) {
  const { t, i18n } = useCopy()
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as SubFlowDslNode
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel={t('nodeTypes.sub-flow')}
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
