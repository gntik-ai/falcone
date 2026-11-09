import { Suspense } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { expect, test } from 'vitest'
import { appRoutes } from '../src/router'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch } from './shell-support'
import { base, confirmed, history, route } from './parity/pages/console-secret-rotation-page.manifest'

function Source() {
  const navigate = useNavigate()
  return <><NavLink to={route} data-testid="rotation-link" /><button onClick={() => navigate(route)} data-testid="rotation-navigate" /></>
}
test.each(['link', 'navigate'])('the lazy rotation route supports %s under the next basename', async (action) => {
  login()
  const requests = strictFetch({ [`GET ${base}/history?limit=20&offset=0`]: history, [`GET ${base}/consumer-status`]: confirmed })
  const consoleRoute = appRoutes.find((entry) => entry.path === '/console')!
  const rotation = consoleRoute.children!.find((entry) => entry.path === 'secrets/:encodedSecretPath/rotate')!
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/secrets']}><Suspense fallback={null}><Routes>
    <Route path="/console/secrets" element={<Source />} />
    <Route path="/console/secrets/:encodedSecretPath/rotate" element={rotation.element} />
  </Routes></Suspense></MemoryRouter>)
  fireEvent.click(screen.getByTestId(`rotation-${action}`))
  expect(await screen.findByRole('heading', { name: 'Rotar secreto', level: 1 })).toBeVisible()
  await waitFor(() => expect(requests.mock).toHaveBeenCalledTimes(2)); requests.verify()
  // Existing navigation remains on legacy until the browser parity gate passes.
  expect(isMigratedRoute(route)).toBe(false)
})
