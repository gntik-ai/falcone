import { useCopy } from '../copy'
// Canvas node for the DSL `branch` construct (change: add-console-flow-designer).
//
// Renders ONE labelled source handle per condition arm (id `arm-<index>`, matching the
// edge sourceHandle convention in flowGraphModel.ts) plus one `default` handle.
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranch } from 'lucide-react'

import { NodeShell } from './NodeShell'
import type { FlowCanvasNodeData } from '../flowGraphModel'
import type { BranchNode as BranchDslNode } from '../flows'

export function BranchNode({ data, selected }: NodeProps) {
  const { t, i18n } = useCopy()
  const nodeData = data as FlowCanvasNodeData
  const dsl = nodeData.dsl as BranchDslNode
  const arms = dsl.arms ?? []
  // Spread the arm handles plus the default handle evenly along the bottom edge.
  const handleCount = arms.length + 1
  const handleLeft = (index: number) => `${((index + 1) / (handleCount + 1)) * 100}%`
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <NodeShell
        typeLabel={t('nodeTypes.branch')}
        label={nodeData.label}
        icon={GitBranch}
        selected={selected}
        validationErrors={nodeData.validationErrors}
        badges={[t('armsBadge', { count: arms.length })]}
      >
        <div className="mt-1 space-y-0.5">
          {arms.map((arm, index) => (
            <div
              key={`arm-${index}`}
              className="truncate font-mono text-xs text-muted-foreground"
              title={arm.when}
            >
              {t('armLabel', { index: index + 1, when: arm.when })}
            </div>
          ))}
        </div>
      </NodeShell>
      {arms.map((_, index) => (
        <Handle
          key={`arm-${index}`}
          type="source"
          position={Position.Bottom}
          id={`arm-${index}`}
          style={{ left: handleLeft(index) }}
        />
      ))}
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
        style={{ left: handleLeft(arms.length) }}
      />
    </>
  )
}
