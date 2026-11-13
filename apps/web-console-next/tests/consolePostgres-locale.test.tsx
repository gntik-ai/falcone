import { render } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { collectPostgresLocaleValues } from './parity/pages/console-postgres-page.locale.mjs'

const data = {
  stateLabel: 'Estado', activeLabel: 'Active', lockTargetsLabel: 'Lock targets',
  inventoryIds: ['pg-/v1/postgres/databases'], lockTargets: ['public.accounts'],
  defaultLabel: 'Default', columnsId: 'pg-/v1/postgres/databases/app_db/schemas/public/tables/accounts/columns',
  warningCategories: ['Locks'], statementCategories: ['Create'],
}
const values = () => collectPostgresLocaleValues(data)

beforeEach(() => {
  // jsdom has no layout; mirror the browser scanner's visible elements.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})

test('only the legacy Active value in an inventory state column is exempt', () => {
  render(<section id={data.inventoryIds[0]}><table><thead><tr><th>Base de datos</th><th>Estado</th></tr></thead><tbody><tr><td>app_db</td><td><span>Active</span></td></tr></tbody></table></section>)
  // Exercise both the leaf text and the aggregate innerText collected in Chromium.
  for (const element of document.querySelectorAll('td, td span')) Object.defineProperty(element, 'innerText', { value: element.textContent })
  expect(values()).not.toContain('Active')
  expect(values()).toContain('Estado')
  expect(values()).toContain('app_db')
})

test('only fixture SQL identifiers in the DDL lock-target group are exempt', () => {
  render(<section data-testid="pg-preview"><div><h3>Lock targets</h3></div><div><span data-tone="neutral">public.accounts</span></div><code>CREATE TABLE public.accounts (id uuid);</code></section>)
  const group = document.querySelector('span')!.parentElement!
  for (const element of [group, group.firstElementChild!]) Object.defineProperty(element, 'innerText', { value: element.textContent })
  const before = document.body.innerHTML
  expect(values()).not.toContain('public.accounts')
  expect(values()).toContain('Lock targets')
  expect(values()).toContain('CREATE TABLE public.accounts (id uuid);')
  expect(document.body.innerHTML).toBe(before)
})

test('accessible names, tooltips, placeholders and labelled-by values remain checked in data fields', () => {
  render(<><section id={data.inventoryIds[0]}><table><thead><tr><th>Base de datos</th><th>Estado</th></tr></thead><tbody><tr><td>app_db</td><td><span aria-label="Active" title="pages.untranslated">Active</span></td></tr></tbody></table></section><section data-testid="pg-preview"><div><h3>Lock targets</h3></div><div><span aria-label="public.accounts" aria-labelledby="missing-key">public.accounts</span></div></section><span id="missing-key">pages.untranslated</span><input placeholder="Select workspace" /><img alt="Search..." /></>)
  expect(values()).toContain('Active')
  expect(values()).toContain('public.accounts')
  expect(values()).toContain('pages.untranslated')
  expect(values()).toContain('Select workspace')
  expect(values()).toContain('Search...')
})

test('the same values outside their data fields remain subject to the locale check', () => {
  render(<><button>Active</button><span>public.accounts</span><section data-testid="pg-preview"><div><h3>Warnings</h3></div><div><span>public.accounts</span></div></section><section id={data.inventoryIds[0]}><table><thead><tr><th>Base de datos</th><th>Owner</th></tr></thead><tbody><tr><td>app_db</td><td>Active</td></tr></tbody></table></section></>)
  expect(values().filter((value) => value === 'Active')).toHaveLength(2)
  expect(values().filter((value) => value === 'public.accounts')).toHaveLength(2)
})

test('English chrome and missing keys inside the data fields are never exempt', () => {
  render(<><section id={data.inventoryIds[0]}><table><thead><tr><th>Base de datos</th><th>Estado</th></tr></thead><tbody><tr><td>app_db</td><td><span>Search...</span></td></tr><tr><td>other_db</td><td><span>pages.untranslated</span></td></tr></tbody></table></section><section data-testid="pg-preview"><div><h3>Lock targets</h3></div><div><span>pages.untranslated</span><button>Search...</button></div></section><div role="region" aria-label="Notifications" /></>)
  expect(values().filter((value) => value === 'Search...')).toHaveLength(2)
  expect(values().filter((value) => value === 'pages.untranslated')).toHaveLength(2)
  expect(values()).toContain('Notifications')
})


test('legacy Default, Locks and Create are exempt only in their own catalog fields', () => {
  render(<><section id={data.columnsId}><table><thead><tr><th data-column-id="default">Default</th></tr></thead></table></section><section data-testid="pg-preview"><div data-severity="high"><div><span data-tone="neutral">Locks</span></div></div><article><div><span data-tone="neutral">Create</span></div></article></section></>)
  expect(values()).not.toContain('Default')
  expect(values()).not.toContain('Locks')
  expect(values()).not.toContain('Create')
})

test('English copy and missing keys in catalog fields and controls still fail the scan', () => {
  render(<><button>Default</button><button>Locks</button><button>Create</button><section id={data.columnsId}><table><thead><tr><th data-column-id="default">pages.untranslated</th></tr></thead></table></section><section data-testid="pg-preview"><div data-severity="high"><div><span data-tone="neutral" aria-label="Locks">Search...</span></div></div><article><div><span data-tone="neutral" title="Create">pages.untranslated</span></div></article></section></>)
  for (const value of ['Default', 'Locks', 'Create', 'Search...', 'pages.untranslated']) expect(values()).toContain(value)
})

test('interactive controls are checked even when placed inside exempt data groups', () => {
  render(<><section id={data.inventoryIds[0]}><table><thead><tr><th>Base de datos</th><th>Estado</th></tr></thead><tbody><tr><td>app_db</td><td><span><button>Active</button></span></td></tr></tbody></table></section><section data-testid="pg-preview"><div><h3>Lock targets</h3></div><div><span data-tone="neutral"><button>public.accounts</button></span></div><div data-severity="high"><div><span data-tone="neutral"><button>Locks</button></span></div></div></section></>)
  expect(values()).toContain('Active')
  expect(values()).toContain('public.accounts')
  expect(values()).toContain('Locks')
})
