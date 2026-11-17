import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConsoleFlowRunPage from '../src/pages/consoleFlowRun'
import { eventsPath, executionPath, executionVariants, flowPath, flowRecord } from './parity/pages/console-flow-run-page.manifest'
import { animations, sseResponse } from './consoleFlowRun-support'
import { login, strictFetch } from './shell-support'
import es from '../src/locales/es/pages.console-flow-run-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => false }) }))
vi.mock('@xyflow/react', async (original) => (await import('./consoleFlowRun-support')).xyflowStub(await original<typeof import('@xyflow/react')>()))

let requests: ReturnType<typeof strictFetch>
const node = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!
async function ready(variant: keyof typeof executionVariants = 'completed') {
  requests = strictFetch({ [`GET ${flowPath}`]: flowRecord, [`GET ${executionPath}`]: executionVariants[variant], [`GET ${eventsPath}`]: () => sseResponse() })
  render(<MemoryRouter initialEntries={['/console/flows/f1/runs/e1']}><Routes><Route path="/console/flows/:flowId/runs/:executionId" element={<ConsoleFlowRunPage />} /></Routes></MemoryRouter>)
  await screen.findByTestId('react-flow-stub')
}
const heading = (name = 'start') => screen.findByRole('heading', { name })
beforeEach(() => {
  animations(); login()
  context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [], selectWorkspace: vi.fn() }
})
afterEach(() => requests?.verify())

test.each([['click', (element: HTMLElement) => fireEvent.click(element)], ['Enter', (element: HTMLElement) => fireEvent.keyDown(element, { key: 'Enter' })], ['Space', (element: HTMLElement) => fireEvent.keyDown(element, { key: ' ' })]] as const)('%s on a run node opens the inspector with focus on its heading', async (_name, act) => {
  await ready(); node('start').focus(); act(node('start'))
  const title = await heading()
  await waitFor(() => expect(title).toHaveFocus())
  expect(screen.getByRole('complementary', { name: es.inspector })).toBeVisible()
})

test('Enter and Space are handled before the canvas default, so they do not also bubble', async () => {
  await ready()
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  node('review').dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  await heading('review')
})

test.each([['the node', () => node('start')], ['the inspector', () => screen.getByTestId('run-node-detail-panel')]] as const)('Escape on %s closes the inspector and returns focus to the same node', async (_name, target) => {
  await ready(); fireEvent.click(node('start')); const title = await heading(); await waitFor(() => expect(title).toHaveFocus())
  fireEvent.keyDown(target(), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'start' })).toBeNull())
  await waitFor(() => expect(node('start')).toHaveFocus())
})

test('Cerrar closes the inspector and returns focus to the node that opened it', async () => {
  await ready(); fireEvent.click(node('done')); await heading('done')
  fireEvent.click(screen.getByTestId('run-node-detail-close'))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'done' })).toBeNull())
  await waitFor(() => expect(node('done')).toHaveFocus())
})

test('Escape on a node with no inspector open is left alone', async () => {
  await ready()
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  node('start').dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

test('Escape in an alert-dialog closes only the dialog and leaves the inspector open', async () => {
  await ready('running')
  fireEvent.click(node('start')); await heading()
  fireEvent.click(screen.getByTestId('run-cancel-button'))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('heading', { name: 'start' })).toBeVisible()
  await waitFor(() => expect(screen.getByTestId('run-cancel-button')).toHaveFocus())
})

test('every primary action is a native button reachable by keyboard', async () => {
  await ready('waiting-approval')
  for (const id of ['run-cancel-button', 'run-approve-button', 'run-reject-button']) {
    const button = screen.getByTestId(id)
    expect(button.tagName).toBe('BUTTON'); expect(button).not.toHaveAttribute('tabindex', '-1')
  }
})
