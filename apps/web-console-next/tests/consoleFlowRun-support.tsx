import type { ReactNode } from 'react'
import { vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'

// A light React Flow stand-in: nodes render as focusable elements with React Flow's own class and
// data attributes, so the page's click and keyboard wiring runs without a layout engine.
export const canvas = { ariaLabelConfig: {} as Record<string, unknown>, nodes: [] as Node[], edges: [] as Edge[] }
export function xyflowStub(real: typeof import('@xyflow/react')) {
  return {
    ...real, ReactFlowProvider: ({ children }: { children: ReactNode }) => children, Handle: () => null, Background: () => null, Controls: () => null,
    ReactFlow: ({ children, nodes, edges, nodeTypes, ariaLabelConfig, onNodeClick }: { children: ReactNode; nodes: Node[]; edges: Edge[]; nodeTypes: Record<string, React.ComponentType<any>>; ariaLabelConfig: Record<string, unknown>; onNodeClick: (event: unknown, node: Node) => void }) => {
      canvas.ariaLabelConfig = ariaLabelConfig; canvas.nodes = nodes; canvas.edges = edges
      return <div data-testid="react-flow-stub">{nodes.map((node) => { const Component = nodeTypes[node.type!]; return <div key={node.id} role="button" tabIndex={0} className="react-flow__node" data-id={node.id} aria-label={node.ariaLabel} onClick={(event) => onNodeClick(event, node)} {...node.domAttributes}><Component data={node.data} selected={node.selected} /></div> })}{children}</div>
    },
  }
}

export const encoder = new TextEncoder()
// A server-sent-events response. `then` runs after the chunks; the stream stays open until `close()`.
export function sseResponse(...chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
export function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c } }), { headers: { 'Content-Type': 'text/event-stream' } })
  return { response, push: (text: string) => controller.enqueue(encoder.encode(text)), end: () => { try { controller.close() } catch { /* Already closed. */ } } }
}
export const animations = () => { Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) }
