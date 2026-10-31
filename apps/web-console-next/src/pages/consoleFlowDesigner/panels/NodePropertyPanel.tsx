import { useCopy } from '../copy'
// Per-node property panel dispatcher (change: add-console-flow-designer).
//
// Shown when a node is selected on the canvas; dispatches to a per-type form. Every
// input is a controlled component writing straight into the in-memory DSL model via
// `onChangeDsl` (no save is triggered).
import { useId } from 'react'

import { ExpressionField } from './ExpressionField'
import { TaskPropertyPanel } from './TaskPropertyPanel'
import type { FlowCanvasNode } from '../flowGraphModel'
import { DesignerButton as Button } from '../controls'
import { Input } from '@gntik-ai/ui'
import { Field, FieldLabel as Label } from '@gntik-ai/ui'
import type {
  ApprovalNode,
  BranchNode,
  FlowNode,
  SubFlowNode,
  TaskNode,
  TaskTypeDescriptor,
  WaitNode
} from '../flows'

const ISO8601_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?$/

interface NodePropertyPanelProps {
  node: FlowCanvasNode
  taskTypes: TaskTypeDescriptor[]
  onChangeDsl: (nodeId: string, next: FlowNode) => void
}

function BranchPanel({ node, onChange }: { node: BranchNode; onChange: (next: BranchNode) => void }) {
  const { t } = useCopy()
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
            label={t('armCondition', { index: index + 1 })}
            value={arm.when}
            onChange={(when) => setArmWhen(index, when)}
          />
          <p className="font-mono text-xs text-muted-foreground">
            {t('nextNode', { next: arm.next || t('connectCanvas') })}
          </p>
          <Button size="sm" variant="ghost" onClick={() => removeArm(index)}>
            {t('removeArm')}
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={addArm}>
        {t('addArm')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t('branchHelp')}
      </p>
    </div>
  )
}

function WaitPanel({ node, onChange }: { node: WaitNode; onChange: (next: WaitNode) => void }) {
  const { t } = useCopy()
  const id = useId()
  const invalid = Boolean(node.duration) && !ISO8601_DURATION.test(node.duration)
  return (
    <div className="space-y-1" data-testid="wait-property-panel">
      <Label htmlFor={id}>{t('duration')}</Label>
      <Input
        id={id}
        placeholder={t('durationPlaceholder')}
        value={node.duration ?? ''}
        onChange={(event) => onChange({ ...node, duration: event.target.value })}
        aria-invalid={invalid}
        className={invalid ? 'border-destructive font-mono' : 'font-mono'}
      />
      {invalid ? (
        <p className="text-xs text-destructive">{t('durationError')}</p>
      ) : null}
    </div>
  )
}

function ApprovalPanel({ node, onChange }: { node: ApprovalNode; onChange: (next: ApprovalNode) => void }) {
  const { t } = useCopy()
  const idBase = useId()
  return (
    <div className="space-y-3" data-testid="approval-property-panel">
      <Field invalid={false} className="space-y-1">
        <Label htmlFor={`${idBase}-approvers`}>{t('approvers')}</Label>
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
      </Field>
      <Field invalid={false} className="space-y-1">
        <Label htmlFor={`${idBase}-timeout`}>{t('timeout')}</Label>
        <Input
          id={`${idBase}-timeout`}
          placeholder={t('timeoutPlaceholder')}
          value={node.timeout ?? ''}
          onChange={(event) => {
            const next: ApprovalNode = { ...node }
            if (event.target.value) next.timeout = event.target.value
            else delete next.timeout
            onChange(next)
          }}
          className="font-mono"
        />
      </Field>
    </div>
  )
}

function SubFlowPanel({ node, onChange }: { node: SubFlowNode; onChange: (next: SubFlowNode) => void }) {
  const { t } = useCopy()
  const idBase = useId()
  return (
    <div className="space-y-3" data-testid="sub-flow-property-panel">
      <Field invalid={false} className="space-y-1">
        <Label htmlFor={`${idBase}-flow`}>{t('flowId')}</Label>
        <Input
          id={`${idBase}-flow`}
          value={node.flowId ?? ''}
          onChange={(event) => onChange({ ...node, flowId: event.target.value })}
          className="font-mono"
        />
      </Field>
      <Field invalid={false} className="space-y-1">
        <Label htmlFor={`${idBase}-version`}>{t('flowVersion')}</Label>
        <Input
          id={`${idBase}-version`}
          value={node.flowVersion ?? ''}
          onChange={(event) => onChange({ ...node, flowVersion: event.target.value })}
          className="font-mono"
        />
      </Field>
    </div>
  )
}

export function NodePropertyPanel({ node, taskTypes, onChangeDsl }: NodePropertyPanelProps) {
  const { t, i18n } = useCopy()
  const nameId = useId()
  const dsl = node.data.dsl
  const apply = (next: FlowNode) => onChangeDsl(node.id, next)

  return (
    <div data-testid="node-property-panel" className="space-y-4 overflow-y-auto p-3">
      <div>
        <h2 id="flow-inspector-heading" tabIndex={-1} className="text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus-ring">
          {t('inspectorTitle', { type: t(`nodeTypes.${dsl.type}`) })}
        </h2>
        <div className="truncate font-mono text-xs text-muted-foreground" title={node.id}>
          {node.id}
        </div>
      </div>
      <Field invalid={false} className="space-y-1">
        <Label htmlFor={nameId}>{t('name')}</Label>
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
      </Field>
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
