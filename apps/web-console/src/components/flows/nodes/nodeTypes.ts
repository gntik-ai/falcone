// nodeTypes registration map for @xyflow/react (change: add-console-flow-designer).
//
// Keys MUST match FlowNode['type'] (types/flows.ts) since flowGraphModel.ts maps the DSL
// node type verbatim onto the canvas node `type`.
import type { NodeTypes } from '@xyflow/react'

import { ApprovalNode } from '@/components/flows/nodes/ApprovalNode'
import { BranchNode } from '@/components/flows/nodes/BranchNode'
import { ParallelNode } from '@/components/flows/nodes/ParallelNode'
import { SequenceNode } from '@/components/flows/nodes/SequenceNode'
import { SubFlowNode } from '@/components/flows/nodes/SubFlowNode'
import { TaskNode } from '@/components/flows/nodes/TaskNode'
import { WaitNode } from '@/components/flows/nodes/WaitNode'

export const flowNodeTypes: NodeTypes = {
  task: TaskNode,
  branch: BranchNode,
  parallel: ParallelNode,
  wait: WaitNode,
  approval: ApprovalNode,
  'sub-flow': SubFlowNode,
  sequence: SequenceNode
}
