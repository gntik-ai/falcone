// Regression test for issue #806 (web-console form-control legibility).
//
// THE BUG: several console form controls were bare native <input>/<select>/<textarea>
// with NO className. Tailwind 3.x preflight sets `color: inherit` on form controls (so they
// inherit the body's near-white --foreground) but only sets `background-color: transparent`
// on button-type inputs — text inputs/selects/textareas keep the UA-white background, giving
// near-white text on white (~1.02:1 contrast, far below WCAG AA 4.5:1) → the typed value is
// invisible in the dark theme.
//
// THE FIX: every such control now renders via the design-system primitives
// (Input/Select/Textarea), which carry `bg-background` (dark) and (Input) `text-foreground`,
// so the value sits on a dark background and is legible.
//
// RED→GREEN logic: on `main` each control is a bare native element whose `className` is the
// empty string, so `/bg-background/` does NOT match → these assertions FAIL (RED). On this
// branch each control is a primitive whose merged className includes `bg-background`
// (and, for inputs, `text-foreground`) → the assertions PASS (GREEN). The assertions are tied
// to the real rendered control located by its production `id`, so they are non-tautological:
// they re-fail if a control is ever reverted to a bare native element.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Mocks --------------------------------------------------------------------------------
// The two data PAGES read only `activeWorkspaceId` from the console context; supplying it
// makes them render their inputs (rather than the "Select a workspace" stub).
const mockUseConsoleContext = vi.fn()
vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

// EventsConsole + FunctionsConsole fire a list call on mount; stub them so the components
// reach their steady render with the form controls present.
vi.mock('@/services/eventsApi', () => ({
  listTopics: vi.fn().mockResolvedValue({ items: [] }),
  createTopic: vi.fn(),
  publishMessage: vi.fn(),
  consumeMessages: vi.fn()
}))
vi.mock('@/services/functionsApi', () => ({
  listFunctions: vi.fn().mockResolvedValue({ items: [] }),
  deployFunction: vi.fn(),
  invokeFunction: vi.fn(),
  listActivations: vi.fn()
}))
// RealtimeConsole only subscribes on a button click; no on-mount call to stub, but mock the
// module so the real SSE client is never imported in jsdom.
vi.mock('@/services/realtimeApi', () => ({
  subscribeRealtimeChanges: vi.fn()
}))

import { ConsolePostgresDataPage } from './ConsolePostgresDataPage'
import { ConsoleMongoDataPage } from './ConsoleMongoDataPage'
import { EventsConsole } from '@/components/console/EventsConsole'
import { FunctionsConsole } from '@/components/console/FunctionsConsole'
import { RealtimeConsole } from '@/components/console/RealtimeConsole'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_a', activeWorkspaceId: 'wrk_a' })
})
afterEach(() => cleanup())

/** Locate a control by its production id and assert it carries the dark-theme background. */
function expectLegibleBackground(container: HTMLElement, id: string) {
  const el = container.querySelector(`#${id}`)
  expect(el, `control #${id} should be rendered`).not.toBeNull()
  expect(el!.className, `control #${id} must carry a theme background (bg-background)`).toMatch(/bg-background/)
}

/** Inputs additionally pin the foreground colour. */
function expectLegibleInput(container: HTMLElement, id: string) {
  expectLegibleBackground(container, id)
  const el = container.querySelector(`#${id}`)
  expect(el!.className, `input #${id} must carry text-foreground`).toMatch(/text-foreground/)
}

describe('issue #806 — console form controls are legible in the dark theme', () => {
  it('ConsolePostgresDataPage: db / schema / table inputs sit on the theme background', () => {
    const { container } = render(<ConsolePostgresDataPage />)
    expectLegibleInput(container, 'pg-db')
    expectLegibleInput(container, 'pg-schema')
    expectLegibleInput(container, 'pg-table')
  })

  it('ConsoleMongoDataPage: db / collection inputs sit on the theme background', () => {
    const { container } = render(<ConsoleMongoDataPage />)
    expectLegibleInput(container, 'mongo-db')
    expectLegibleInput(container, 'mongo-collection')
  })

  it('RealtimeConsole: source select + db/collection/key inputs sit on the theme background', () => {
    // Scenario B from the spec: the realtime subscribe form.
    const { container } = render(<RealtimeConsole workspaceId="wrk_a" />)
    expectLegibleBackground(container, 'rt-source') // <Select> (inherited foreground is legible on its bg)
    expectLegibleInput(container, 'rt-db')
    expectLegibleInput(container, 'rt-collection')
    expectLegibleInput(container, 'rt-key')
  })

  it('EventsConsole: new-topic input + message textarea sit on the theme background', () => {
    const { container } = render(<EventsConsole workspaceId="wrk_a" />)
    expectLegibleInput(container, 'new-topic')
    expectLegibleBackground(container, 'message-json') // <Textarea>
  })

  it('FunctionsConsole: deploy-spec + input textareas sit on the theme background', () => {
    const { container } = render(<FunctionsConsole tenantId="ten_a" workspaceId="wrk_a" />)
    expectLegibleBackground(container, 'deploy-spec-json') // <Textarea>
    expectLegibleBackground(container, 'input-json') // <Textarea>
  })
})
