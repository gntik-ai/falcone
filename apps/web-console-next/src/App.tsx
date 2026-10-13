import { falconePreset, LiveAnnouncer, Logo, ThemeProvider } from '@gntik-ai/ui'
import { ConsoleRoutes } from './router'

export function App() {
  return (
    <ThemeProvider brand={falconePreset} defaultMode="dark" storageKey="falcone-next-theme">
      <LiveAnnouncer>
        <header className="border-b border-border p-4">
          <Logo wordmark />
        </header>
        <main className="p-6">
          <ConsoleRoutes />
        </main>
      </LiveAnnouncer>
    </ThemeProvider>
  )
}
