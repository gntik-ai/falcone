import { I18nProvider, falconePreset, LiveAnnouncer, Logo, ThemeProvider } from '@gntik-ai/ui'
import { LayoutDashboard } from 'lucide-react'
import { ConsoleRoutes } from './router'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { LocaleSwitch } from './i18n/LocaleSwitch'

declare const __APP_VERSION__: string
declare const __APP_COMMIT_SHA__: string

export function App() {
  const { t, i18n } = useTranslation('common')
  const consoleRoute = /^\/console(?:\/|$)/.test(useLocation().pathname)
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
  const commitSha = typeof __APP_COMMIT_SHA__ === 'string' ? __APP_COMMIT_SHA__ : ''
  return (
    <ThemeProvider brand={falconePreset} defaultMode="dark" storageKey="falcone-next-theme">
      <I18nProvider locale={i18n.language}><LiveAnnouncer>
        {!consoleRoute && <header className="flex items-center gap-3 border-b border-border p-4">
          <Logo wordmark />
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
        {consoleRoute ? <ConsoleRoutes /> : <main className="p-6"><ConsoleRoutes /></main>}
      </LiveAnnouncer></I18nProvider>
    </ThemeProvider>
  )
}
