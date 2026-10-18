import { login, strictFetch } from './shell-support'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { App } from '../src/App'
import { appRoutes, routerBasename } from '../src/router'
import { fullPaths, legacyRoutes } from './legacy-routes'

test('the scaffold retains the legacy normalized full route set, including index and wildcard paths', () => {
  const expected = fullPaths(legacyRoutes())
  expect(expected).toContain('/console/')
  expect(expected).toContain('/console/*')
  expect(expected).toContain('/*')
  expect(fullPaths(appRoutes)).toEqual(expected)
})

test('path normalization joins nested children, preserves index markers and ignores pathless layouts', () => {
  expect(fullPaths([{ path: '/console', children: [{ children: [
    { index: true }, { path: 'flows', children: [{ path: ':flowId' }, { path: '*' }] }
  ] }] }])).toEqual(new Set(['/console', '/console/', '/console/flows', '/console/flows/:flowId', '/console/flows/*']))
})

test.each([
  ['/next/', '/next/console/overview', '/next'],
  ['/', '/console/overview', '/'],
  [undefined, '/console/overview', '/']
])('the overview renders under base %s', async (base, location, expectedBasename) => {
  const basename = routerBasename(base)
  expect(basename).toBe(expectedBasename)
  render(<MemoryRouter basename={basename} initialEntries={[location]}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeVisible()
})

let requests: ReturnType<typeof strictFetch>
beforeEach(() => { login(['tenant_owner']); requests = strictFetch({}) })
afterEach(() => requests.verify())
