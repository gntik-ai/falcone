import { falconePreset, LiveAnnouncer, Logo, ThemeProvider } from '@gntik-ai/ui'
import { LayoutDashboard } from 'lucide-react'
import { ConsoleRoutes } from './router'

export function App() {
  return (
    <ThemeProvider brand={falconePreset} defaultMode="dark" storageKey="falcone-next-theme">
      <LiveAnnouncer>
        <header className="flex items-center gap-3 border-b border-border p-4">
          <Logo wordmark />
          <LayoutDashboard role="img" aria-label="Consola" size={20} />
        </header>
        <main className="p-6">
          <ConsoleRoutes />
        </main>
      </LiveAnnouncer>
    </ThemeProvider>
  )
}
