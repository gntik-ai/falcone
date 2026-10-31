// nodeTypes registration map for @xyflow/react (change: add-console-flow-designer).
//
// Keys MUST match FlowNode['type'] (types/flows.ts) since flowGraphModel.ts maps the DSL
// node type verbatim onto the canvas node `type`.
import type { NodeTypes } from '@xyflow/react'

import { ApprovalNode } from './ApprovalNode'
import { BranchNode } from './BranchNode'
import { ParallelNode } from './ParallelNode'
import { SequenceNode } from './SequenceNode'
import { SubFlowNode } from './SubFlowNode'
import { TaskNode } from './TaskNode'
import { WaitNode } from './WaitNode'

export const flowNodeTypes: NodeTypes = {
  task: TaskNode,
  branch: BranchNode,
  parallel: ParallelNode,
  wait: WaitNode,
  approval: ApprovalNode,
  'sub-flow': SubFlowNode,
  sequence: SequenceNode
}
