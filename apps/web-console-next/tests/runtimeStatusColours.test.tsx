import { screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import ConsoleRuntimePage from '../src/pages/consoleRuntime'
import { ConsoleContextProvider } from '../src/shell/context'
import es from '../src/locales/es/pages.console-runtime-page.json'
import { ready, runtimePath } from './parity/pages/consoleRuntime.manifest'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test.each([
  ['ready', es.state.ready, 'success'],
  ['degraded', es.state.degraded, 'warning'],
  ['unavailable', es.state.unavailable, 'warning'],
  ['unverified', es.state.unverified, 'neutral'],
  ['disabled', es.state.disabled, 'neutral'],
  ['rebuilding', es.state.unknown, 'neutral'],
])('runtime state %s retains its semantic tone', async (state, label, tone) => {
  login(['platform_auditor'])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    [`GET ${runtimePath}`]: { ...ready, state },
  })
  renderWithSession(<ConsoleContextProvider><ConsoleRuntimePage /></ConsoleContextProvider>, { route: '/console/runtime' })

  const status = await screen.findByLabelText(es.statusName.replace('{state}', label))
  expect(status).toHaveAttribute('data-tone', tone)
})
