// Canvas node for the DSL `parallel` construct (change: add-console-flow-designer).
//
// `branches` edges leave through the bottom `branches` handle; the post-join `next`
// edge leaves through the right-hand `next` handle (matching flowGraphModel.ts kinds).
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Layers } from 'lucide-react'

import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowCanvasNodeData } from '@/components/flows/flowGraphModel'
import type { ParallelNode as ParallelDslNode } from '@/types/flows'

export function ParallelNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as ParallelDslNode
  const branchCount = dsl.branches?.length ?? 0
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel="Parallel"
        label={nodeData.label}
        icon={Layers}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={[`${branchCount} branch${branchCount === 1 ? '' : 'es'}`]}
      />
      <Handle type="source" position={Position.Bottom} id="branches" />
      <Handle type="source" position={Position.Right} id="next" />
    </>
  )
}
