import { falconePreset, LiveAnnouncer, Logo, ThemeProvider } from '@gntik-ai/ui'
import { AppRouter } from './router'

export function App({ basename }: { basename?: string }) {
  return (
    <ThemeProvider brand={falconePreset} defaultMode="dark" storageKey="falcone-next-theme">
      <LiveAnnouncer>
        <div className="min-h-screen bg-background text-foreground">
          <header className="border-b border-border p-4">
            <Logo wordmark />
          </header>
          <main className="p-6">
            <AppRouter basename={basename} />
          </main>
        </div>
      </LiveAnnouncer>
    </ThemeProvider>
  )
}
