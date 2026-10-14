import { falconePreset, LiveAnnouncer, Logo, ThemeProvider } from '@gntik-ai/ui'
import { LayoutDashboard } from 'lucide-react'
import { ConsoleRoutes } from './router'

declare const __APP_VERSION__: string
declare const __APP_COMMIT_SHA__: string

export function App() {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
  const commitSha = typeof __APP_COMMIT_SHA__ === 'string' ? __APP_COMMIT_SHA__ : ''
  return (
    <ThemeProvider brand={falconePreset} defaultMode="dark" storageKey="falcone-next-theme">
      <LiveAnnouncer>
        <header className="flex items-center gap-3 border-b border-border p-4">
          <Logo wordmark />
          <LayoutDashboard role="img" aria-label="Consola" size={20} />
          <details className="ml-auto text-sm">
            <summary className="cursor-pointer">Acerca de</summary>
            <p>{version}{commitSha ? ` · ${commitSha.slice(0, 7)}` : ''}</p>
          </details>
        </header>
        <main className="p-6">
          <ConsoleRoutes />
        </main>
      </LiveAnnouncer>
    </ThemeProvider>
  )
}
