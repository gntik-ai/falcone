import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectColumns, copyToClipboard, formatCell, parseJsonObject, prettyJson } from './editor-ux'

describe('formatCell', () => {
  it('renders null/undefined as empty string', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined)).toBe('')
  })
  it('stringifies objects and arrays', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}')
    expect(formatCell([1, 2])).toBe('[1,2]')
  })
  it('coerces primitives', () => {
    expect(formatCell(42)).toBe('42')
    expect(formatCell(true)).toBe('true')
  })
})

describe('collectColumns', () => {
  it('returns the stable union of keys across rows', () => {
    expect(collectColumns([{ id: 1, a: 1 }, { id: 2, b: 2 }])).toEqual(['id', 'a', 'b'])
  })
  it('handles an empty set', () => {
    expect(collectColumns([])).toEqual([])
  })
})

describe('parseJsonObject', () => {
  it('accepts a JSON object', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })
  it('rejects invalid JSON with a friendly error', () => {
    expect(parseJsonObject('{nope')).toEqual({ ok: false, error: 'Not valid JSON' })
  })
  it('rejects non-objects (array / scalar / null)', () => {
    expect(parseJsonObject('[1,2]')).toEqual({ ok: false, error: 'Expected a JSON object' })
    expect(parseJsonObject('5')).toEqual({ ok: false, error: 'Expected a JSON object' })
    expect(parseJsonObject('null')).toEqual({ ok: false, error: 'Expected a JSON object' })
  })
})

describe('prettyJson', () => {
  it('formats with 2-space indent and defaults nullish to {}', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(prettyJson(null)).toBe('{}')
  })
})

describe('copyToClipboard', () => {
  const original = globalThis.navigator
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
  })

  it('returns true and writes when the clipboard API is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true })
    await expect(copyToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('returns false when the clipboard API is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
    await expect(copyToClipboard('hello')).resolves.toBe(false)
  })
})
