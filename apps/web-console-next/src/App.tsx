import { I18nProvider, falconePreset, LiveAnnouncer, Logo, ThemeProvider } from '@gntik-ai/ui'
import { LayoutDashboard } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { appRoutes, ConsoleRoutes } from './router'
import { useTranslation } from 'react-i18next'
import { matchRoutes, useLocation } from 'react-router-dom'
import { LocaleSwitch } from './i18n/LocaleSwitch'

declare const __APP_VERSION__: string
declare const __APP_COMMIT_SHA__: string

export function App() {
  const { t, i18n } = useTranslation('common')
  const location = useLocation()
  const consoleRoute = /^\/console(?:\/|$)/.test(location.pathname)
  const ownLayout = matchRoutes(appRoutes, location)?.some((match) => match.route.handle?.ownLayout) ?? false
  const previousPath = useRef(location.pathname)
  useEffect(() => {
    const navigated = previousPath.current !== location.pathname
    previousPath.current = location.pathname
    if (!navigated || !ownLayout || location.pathname !== '/') return
    // Suspense can replace or hide main before the navigation has painted.
    const focusMain = () => {
      const main = document.getElementById('welcome-main')
      if (!main?.isConnected || main.closest('[hidden], [inert]')) return false
      if (main.contains(document.activeElement)) return true
      main.focus()
      return document.activeElement === main
    }
    const observer = new MutationObserver(() => { focusMain() })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'hidden', 'inert', 'style', 'class'] })
    let frame: number
    const afterPaint = () => {
      if (focusMain()) observer.disconnect()
      else frame = requestAnimationFrame(afterPaint)
    }
    focusMain()
    frame = requestAnimationFrame(afterPaint)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [location.pathname, ownLayout])
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
  const commitSha = typeof __APP_COMMIT_SHA__ === 'string' ? __APP_COMMIT_SHA__ : ''
  return (
    <ThemeProvider brand={falconePreset} defaultMode="dark" storageKey="falcone-next-theme">
      <I18nProvider locale={i18n.language}><LiveAnnouncer>
        {!consoleRoute && <header className="flex items-center gap-3 border-b border-border p-4">
          {!ownLayout && <Logo wordmark />}
          <LayoutDashboard role="img" aria-label={t('shell.console')} size={20} />
          <details className="ml-auto text-sm">
            <summary className="cursor-pointer">{t('shell.userMenu')}</summary>
            <LocaleSwitch />
          </details>
          <details className="text-sm">
            <summary className="cursor-pointer">{t('shell.about')}</summary>
            <p>{version}{commitSha ? ` · ${commitSha.slice(0, 7)}` : ''}</p>
          </details>
        </header>}
        {consoleRoute || ownLayout ? <ConsoleRoutes /> : <main className="p-6"><ConsoleRoutes /></main>}
      </LiveAnnouncer></I18nProvider>
    </ThemeProvider>
  )
}
