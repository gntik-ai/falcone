import { useEffect, useState } from 'react'
import { pollSdkStatus, requestSdkGeneration, type SdkPackageStatus } from '@/lib/console-openapi-sdk'

interface Props {
  workspaceId: string
  currentSpecVersion: string
}

const SUPPORTED_LANGUAGES: Array<'typescript' | 'python'> = ['typescript', 'python']

export function SdkDownloadPanel({ workspaceId, currentSpecVersion }: Props) {
  const [statuses, setStatuses] = useState<Record<string, SdkPackageStatus | null>>({})

  useEffect(() => {
    let active = true
    const intervals: number[] = []

    async function refresh(language: 'typescript' | 'python') {
      try {
        const status = await pollSdkStatus(workspaceId, language)
        if (active) setStatuses((current) => ({ ...current, [language]: status }))
      } catch {
        if (active) setStatuses((current) => ({ ...current, [language]: null }))
      }
    }

    for (const language of SUPPORTED_LANGUAGES) {
      void refresh(language)
      const id = window.setInterval(() => void refresh(language), 5000)
      intervals.push(id)
    }

    return () => {
      active = false
      intervals.forEach((id) => window.clearInterval(id))
    }
  }, [workspaceId])

  return (
    <section>
      <h2>SDK downloads</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {SUPPORTED_LANGUAGES.map((language) => {
          const status = statuses[language]
          return (
            <article key={language} className="rounded border p-4">
              <h3 className="capitalize">{language}</h3>
              <p>Current spec: {currentSpecVersion}</p>
              <p>Status: {status?.status ?? 'pending'}</p>
              {status?.status === 'ready' && status.downloadUrl ? <a href={status.downloadUrl}>Download SDK</a> : null}
              {status?.status === 'failed' ? <p className="text-red-600">{status.errorMessage}</p> : null}
              {(status?.status === 'stale' || !status) ? (
                <button type="button" onClick={() => void requestSdkGeneration(workspaceId, language)}>Regenerate</button>
              ) : null}
              {(status?.status === 'pending' || status?.status === 'building') ? <p>Generating your SDK…</p> : null}
            </article>
          )
        })}
      </div>
      <article className="mt-4 rounded border p-4">
        <h3>Need another language?</h3>
        <a href="https://openapi-generator.tech/docs/generators">OpenAPI Generator language catalog</a>
      </article>
    </section>
  )
}
