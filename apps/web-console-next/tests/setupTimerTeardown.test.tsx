import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

const fired: string[] = []

function CopyFeedback({ label }: { label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" onClick={() => { setCopied(true); setTimeout(() => { fired.push(label); setCopied(false) }, 40) }}>
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

test('real timer left pending by a test: scheduled after unmount cleanup', () => {
  render(<CopyFeedback label="real" />)
  fireEvent.click(screen.getByRole('button', { name: 'copy' }))
  expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument()
})

test('real timer from the previous test does not run after teardown', async () => {
  await wait(120)
  expect(fired).not.toContain('real')
})

test('fake timers left enabled by a test: pending timer is scheduled', () => {
  vi.useFakeTimers()
  render(<CopyFeedback label="fake" />)
  fireEvent.click(screen.getByRole('button', { name: 'copy' }))
  expect(vi.getTimerCount()).toBeGreaterThan(0)
})

test('fake timers are flushed while the environment is alive and real timers are restored', () => {
  expect(fired).toContain('fake')
  expect(vi.isFakeTimers()).toBe(false)
})

test.fails('an assertion failure is still reported as a failure', () => {
  expect(1).toBe(2)
})

test.fails('an error thrown synchronously is still reported as a failure', () => {
  throw new Error('synthetic failure')
})

test.fails('an error thrown with fake timers left enabled is still reported as a failure', () => {
  vi.useFakeTimers()
  throw new Error('synthetic failure')
})


test.fails('a throwing pending fake timer is reported and leaves a real timer pending', () => {
  setTimeout(() => { fired.push('real-after-throw') }, 40)
  vi.useFakeTimers()
  setTimeout(() => { throw new Error('synthetic timer failure') }, 10)
})

test('real timer left pending behind a throwing fake timer does not run after teardown', async () => {
  await wait(120)
  expect(fired).not.toContain('real-after-throw')
  expect(vi.isFakeTimers()).toBe(false)
})
