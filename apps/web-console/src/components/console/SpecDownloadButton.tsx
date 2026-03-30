import { useState } from 'react'
import { downloadSpec } from '@/lib/console-openapi-sdk'

interface Props {
  workspaceId: string
  specVersion: string
  lastUpdated: string
}

export function SpecDownloadButton({ workspaceId, specVersion, lastUpdated }: Props) {
  const [format, setFormat] = useState<'json' | 'yaml'>('json')
  const [loading, setLoading] = useState(false)

  return (
    <div className="flex items-center gap-3">
      <select value={format} onChange={(event) => setFormat(event.target.value as 'json' | 'yaml')}>
        <option value="json">JSON</option>
        <option value="yaml">YAML</option>
      </select>
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          setLoading(true)
          try {
            await downloadSpec(workspaceId, format)
          } finally {
            setLoading(false)
          }
        }}
      >
        {loading ? 'Downloading…' : `Download ${format.toUpperCase()}`}
      </button>
      <span>{`v${specVersion}`}</span>
      <time dateTime={lastUpdated}>{lastUpdated}</time>
    </div>
  )
}
