import { lazy } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { Button } from '@gntik-ai/ui'
import { useTranslation } from 'react-i18next'
import { RouteState } from '../RouteState'

const LazyDestination = lazy(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  return import('./LazyDestination')
})
function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  return <section><h1>{t('shell.fixtures.home')}</h1>
    <NavLink to="/console/__fixture/lazy">{t('shell.fixtures.link')}</NavLink>
    <Button onClick={() => navigate('/console/__fixture/lazy')}>{t('shell.fixtures.navigate')}</Button>
  </section>
}
function QuotasLink() {
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  return <section><h1>{t('shell.fixtures.home')}</h1>
    <NavLink to="/console/quotas">{t('shell.fixtures.link')}</NavLink>
    <Button type="button" onClick={() => navigate('/console/quotas')}>{t('shell.fixtures.navigate')}</Button>
  </section>
}
function Throw(): never { throw new Error('synthetic-render-failure') }
export default function FixtureRoutes() {
  return <Routes>
    <Route path="quotas-link" element={<QuotasLink />} />
    <Route path="home" element={<Home />} />
    <Route path="lazy" element={<LazyDestination />} />
    <Route path="throw" element={<Throw />} />
    <Route path="forbidden" element={<RouteState state="forbidden" />} />
  </Routes>
}
