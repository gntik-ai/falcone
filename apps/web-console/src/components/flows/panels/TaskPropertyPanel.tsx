// Property panel for task nodes (change: add-console-flow-designer).
//
// Form fields are generated from the matching TaskTypeDescriptor.inputSchema (JSON
// Schema). Per design.md D5 only the types the DSL actually needs are rendered:
// string, number, boolean, and enum (select). Properties annotated with
// `x-falcone-expression: true` render as expression inputs with FLW-E005 feedback.
import { useId } from 'react'

import { ExpressionField } from '@/components/flows/panels/ExpressionField'
import { RetryPolicyEditor } from '@/components/flows/panels/RetryPolicyEditor'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectItem } from '@/components/ui/select'
import type {
  JsonSchemaProperty,
  RetryPolicy,
  TaskNode as TaskDslNode,
  TaskTypeDescriptor
} from '@/types/flows'

interface TaskPropertyPanelProps {
  node: TaskDslNode
  descriptor: TaskTypeDescriptor | undefined
  onChange: (next: TaskDslNode) => void
}

function SchemaField({
  name,
  schema,
  required,
  value,
  onChange
}: {
  name: string
  schema: JsonSchemaProperty
  required: boolean
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const label = `${name}${required ? ' *' : ''}`

  if (schema['x-falcone-expression'] === true) {
    return (
      <ExpressionField
        label={label}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        description={schema.description}
      />
    )
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        >
          <SelectItem value="">—</SelectItem>
          {schema.enum.map((option) => (
            <SelectItem key={String(option)} value={String(option)}>
              {String(option)}
            </SelectItem>
          ))}
        </Select>
        {schema.description ? <p className="text-xs text-muted-foreground">{schema.description}</p> : null}
      </div>
    )
  }

  if (schema.type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <Label htmlFor={id}>{label}</Label>
      </div>
    )
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          inputMode="decimal"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => {
            const text = event.target.value
            if (text.trim() === '') {
              onChange(undefined)
              return
            }
            const parsed = Number(text)
            if (Number.isFinite(parsed)) onChange(schema.type === 'integer' ? Math.trunc(parsed) : parsed)
          }}
        />
        {schema.description ? <p className="text-xs text-muted-foreground">{schema.description}</p> : null}
      </div>
    )
  }

  // Default: string input.
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
      {schema.description ? <p className="text-xs text-muted-foreground">{schema.description}</p> : null}
    </div>
  )
}

export function TaskPropertyPanel({ node, descriptor, onChange }: TaskPropertyPanelProps) {
  const properties = descriptor?.inputSchema?.properties ?? {}
  const required = new Set(descriptor?.inputSchema?.required ?? [])

  const setInput = (name: string, value: unknown) => {
    const input = { ...(node.input ?? {}) }
    if (value === undefined) {
      delete input[name]
    } else {
      input[name] = value
    }
    onChange({ ...node, input })
  }

  const setRetryPolicy = (retryPolicy: RetryPolicy | undefined) => {
    const next: TaskDslNode = { ...node }
    if (retryPolicy === undefined) {
      delete next.retryPolicy
    } else {
      next.retryPolicy = retryPolicy
    }
    onChange(next)
  }

  return (
    <div data-testid="task-property-panel" className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Task type: <span className="font-mono">{node.taskType}</span>
      </div>
      {descriptor === undefined ? (
        <p className="text-xs text-destructive">
          Unknown task type — not present in the task-type catalog (FLW-E006).
        </p>
      ) : null}
      {Object.entries(properties).map(([name, schema]) => (
        <SchemaField
          key={name}
          name={name}
          schema={schema}
          required={required.has(name)}
          value={node.input?.[name]}
          onChange={(value) => setInput(name, value)}
        />
      ))}
      <RetryPolicyEditor value={node.retryPolicy} onChange={setRetryPolicy} />
    </div>
  )
}
