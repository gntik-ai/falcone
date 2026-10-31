import { render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { collectDesignerLocaleValues } from './parity/pages/console-flow-designer-page.locale.mjs'

beforeEach(() => {
  // jsdom has no layout; make rendered elements visible to the browser's scanner.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})

test('only canonical version tokens in rendered YAML are exempt from the locale key check', () => {
  render(<div data-testid="monaco-yaml-surface"><div className="view-lines"><span>apiVersion: </span><span>v1.0</span><span>pages.untranslated</span></div></div>)
  const values = collectDesignerLocaleValues('v1.0')
  expect(values).not.toContain('v1.0')
  expect(values).toContain('pages.untranslated')
})

test('version-like copy outside YAML and accessible labels inside YAML are still checked', () => {
  render(<><span>v1.0</span><div data-testid="monaco-yaml-surface"><div className="view-lines"><span aria-label="v1.0" title="pages.untranslated">v1.0</span></div></div></>)
  expect(collectDesignerLocaleValues('v1.0').filter((value: string) => value === 'v1.0')).toHaveLength(2)
  expect(collectDesignerLocaleValues('v1.0')).toContain('pages.untranslated')
})

test('the whole-page locale scan keeps toast names and English chrome in YAML', () => {
  render(<><div role="region" aria-label="Notifications" /><div data-testid="monaco-yaml-surface"><div className="view-lines"><span>Search...</span></div></div></>)
  expect(collectDesignerLocaleValues('v1.0')).toContain('Notifications')
  expect(collectDesignerLocaleValues('v1.0')).toContain('Search...')
})
