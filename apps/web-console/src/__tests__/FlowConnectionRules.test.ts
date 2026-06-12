// bbx: interaction-time connection-rule enforcement (change: add-console-flow-designer).
import { describe, expect, it } from 'vitest'

import { evaluateConnection, isValidConnection } from '@/components/flows/connectionRules'
import type { FlowCanvasEdge, FlowCanvasNode } from '@/components/flows/flowGraphModel'
import type { FlowNode } from '@/types/flows'

function node(id: string, type: FlowNode['type'], dslExtra: Record<string, unknown> = {}): FlowCanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      dsl: { id, type, ...dslExtra } as unknown as FlowNode,
      label: id,
      validationErrors: []
    }
  }
}

function edge(source: string, target: string, sourceHandle?: string): FlowCanvasEdge {
  return { id: `${source}__${sourceHandle ?? 'next'}__${target}`, source, target, sourceHandle: sourceHandle ?? null }
}

const taskA = node('a', 'task', { taskType: 'send-email' })
const taskB = node('b', 'task', { taskType: 'send-email' })
const taskC = node('c', 'task', { taskType: 'send-email' })
const branch = node('br', 'branch', { arms: [{ when: 'true', next: 'b' }] })

describe('connectionRules.isValidConnection', () => {
  it('rejects a self-loop (source === target)', () => {
    const verdict = evaluateConnection({ source: 'a', target: 'a' }, [taskA], [])
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('SELF_LOOP')
    expect(isValidConnection({ source: 'a', target: 'a' }, [taskA], [])).toBe(false)
  })

  it('rejects an edge that would create a cycle (FLW-E002)', () => {
    // a -> b -> c exists; c -> a closes a cycle.
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const verdict = evaluateConnection({ source: 'c', target: 'a' }, [taskA, taskB, taskC], edges)
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('FLW-E002')
    expect(verdict.message).toContain('FLW-E002')
  })

  it('accepts a valid forward connection', () => {
    const edges = [edge('a', 'b')]
    expect(isValidConnection({ source: 'b', target: 'c' }, [taskA, taskB, taskC], edges)).toBe(true)
  })

  it('rejects a second outgoing edge on an occupied branch condition-arm handle', () => {
    const edges = [edge('br', 'b', 'arm-0')]
    const verdict = evaluateConnection(
      { source: 'br', target: 'c', sourceHandle: 'arm-0' },
      [branch, taskB, taskC],
      edges
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('BRANCH_ARM_ARITY')
  })

  it('accepts a connection on a free branch handle', () => {
    const edges = [edge('br', 'b', 'arm-0')]
    expect(
      isValidConnection({ source: 'br', target: 'c', sourceHandle: 'default' }, [branch, taskB, taskC], edges)
    ).toBe(true)
  })

  it('rejects a second outgoing edge from a single-next node type', () => {
    const edges = [edge('a', 'b')]
    const verdict = evaluateConnection({ source: 'a', target: 'c' }, [taskA, taskB, taskC], edges)
    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('NEXT_ARITY')
  })

  it('rejects an incomplete connection (missing source or target)', () => {
    expect(isValidConnection({ source: null, target: 'a' }, [taskA], [])).toBe(false)
    expect(isValidConnection({ source: 'a', target: null }, [taskA], [])).toBe(false)
  })
})
