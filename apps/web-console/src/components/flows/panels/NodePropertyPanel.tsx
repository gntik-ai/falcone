// Per-node property panel dispatcher (change: add-console-flow-designer).
//
// Shown when a node is selected on the canvas; dispatches to a per-type form. Every
// input is a controlled component writing straight into the in-memory DSL model via
// `onChangeDsl` (no save is triggered).
import { useId } from 'react'

import { ExpressionField } from '@/components/flows/panels/ExpressionField'
import { TaskPropertyPanel } from '@/components/flows/panels/TaskPropertyPanel'
import type { FlowCanvasNode } from '@/components/flows/flowGraphModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  ApprovalNode,
  BranchNode,
  FlowNode,
  SubFlowNode,
  TaskNode,
  TaskTypeDescriptor,
  WaitNode
} from '@/types/flows'

const ISO8601_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?$/

interface NodePropertyPanelProps {
  node: FlowCanvasNode
  taskTypes: TaskTypeDescriptor[]
  onChangeDsl: (nodeId: string, next: FlowNode) => void
}

function BranchPanel({ node, onChange }: { node: BranchNode; onChange: (next: BranchNode) => void }) {
  const arms = node.arms ?? []
  const setArmWhen = (index: number, when: string) => {
    onChange({ ...node, arms: arms.map((arm, i) => (i === index ? { ...arm, when } : arm)) })
  }
  const addArm = () => {
    onChange({ ...node, arms: [...arms, { when: '', next: '' }] })
  }
  const removeArm = (index: number) => {
    onChange({ ...node, arms: arms.filter((_, i) => i !== index) })
  }
  return (
    <div className="space-y-3" data-testid="branch-property-panel">
      {arms.map((arm, index) => (
        <div key={index} className="space-y-1 rounded-lg border border-border p-2">
          <ExpressionField
            label={`Arm ${index + 1} condition`}
            value={arm.when}
            onChange={(when) => setArmWhen(index, when)}
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            next: {arm.next || '(connect on canvas)'}
          </p>
          <Button size="sm" variant="ghost" onClick={() => removeArm(index)}>
            Remove arm
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={addArm}>
        Add arm
      </Button>
      <p className="text-xs text-muted-foreground">
        A branch needs at least two arms, or one arm plus a default connection (FLW-E009).
      </p>
    </div>
  )
}

function WaitPanel({ node, onChange }: { node: WaitNode; onChange: (next: WaitNode) => void }) {
  const id = useId()
  const invalid = Boolean(node.duration) && !ISO8601_DURATION.test(node.duration)
  return (
    <div className="space-y-1" data-testid="wait-property-panel">
      <Label htmlFor={id}>Duration (ISO 8601)</Label>
      <Input
        id={id}
        placeholder="PT10M"
        value={node.duration ?? ''}
        onChange={(event) => onChange({ ...node, duration: event.target.value })}
        aria-invalid={invalid}
        className={invalid ? 'border-destructive font-mono' : 'font-mono'}
      />
      {invalid ? (
        <p className="text-xs text-destructive">FLW-E008: not a valid ISO 8601 duration (e.g. PT10M).</p>
      ) : null}
    </div>
  )
}

function ApprovalPanel({ node, onChange }: { node: ApprovalNode; onChange: (next: ApprovalNode) => void }) {
  const idBase = useId()
  return (
    <div className="space-y-3" data-testid="approval-property-panel">
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-approvers`}>Approvers (comma-separated)</Label>
        <Input
          id={`${idBase}-approvers`}
          value={(node.approvers ?? []).join(', ')}
          onChange={(event) => {
            const approvers = event.target.value
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
            const next: ApprovalNode = { ...node }
            if (approvers.length > 0) next.approvers = approvers
            else delete next.approvers
            onChange(next)
          }}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-timeout`}>Timeout (ISO 8601)</Label>
        <Input
          id={`${idBase}-timeout`}
          placeholder="P1D"
          value={node.timeout ?? ''}
          onChange={(event) => {
            const next: ApprovalNode = { ...node }
            if (event.target.value) next.timeout = event.target.value
            else delete next.timeout
            onChange(next)
          }}
          className="font-mono"
        />
      </div>
    </div>
  )
}

function SubFlowPanel({ node, onChange }: { node: SubFlowNode; onChange: (next: SubFlowNode) => void }) {
  const idBase = useId()
  return (
    <div className="space-y-3" data-testid="sub-flow-property-panel">
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-flow`}>Flow ID</Label>
        <Input
          id={`${idBase}-flow`}
          value={node.flowId ?? ''}
          onChange={(event) => onChange({ ...node, flowId: event.target.value })}
          className="font-mono"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idBase}-version`}>Flow version</Label>
        <Input
          id={`${idBase}-version`}
          value={node.flowVersion ?? ''}
          onChange={(event) => onChange({ ...node, flowVersion: event.target.value })}
          className="font-mono"
        />
      </div>
    </div>
  )
}

export function NodePropertyPanel({ node, taskTypes, onChangeDsl }: NodePropertyPanelProps) {
  const nameId = useId()
  const dsl = node.data.dsl
  const apply = (next: FlowNode) => onChangeDsl(node.id, next)

  return (
    <div data-testid="node-property-panel" className="space-y-4 overflow-y-auto p-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {dsl.type}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground" title={node.id}>
          {node.id}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={dsl.name ?? ''}
          onChange={(event) => {
            const next = { ...dsl } as FlowNode
            if (event.target.value) next.name = event.target.value
            else delete next.name
            apply(next)
          }}
        />
      </div>
      {dsl.type === 'task' ? (
        <TaskPropertyPanel
          node={dsl as TaskNode}
          descriptor={taskTypes.find((descriptor) => descriptor.id === (dsl as TaskNode).taskType)}
          onChange={apply}
        />
      ) : null}
      {dsl.type === 'branch' ? <BranchPanel node={dsl as BranchNode} onChange={apply} /> : null}
      {dsl.type === 'wait' ? <WaitPanel node={dsl as WaitNode} onChange={apply} /> : null}
      {dsl.type === 'approval' ? <ApprovalPanel node={dsl as ApprovalNode} onChange={apply} /> : null}
      {dsl.type === 'sub-flow' ? <SubFlowPanel node={dsl as SubFlowNode} onChange={apply} /> : null}
    </div>
  )
}
