import { Suspense } from 'react'

interface Props {
  workspaceId: string
  specVersion: string
}

function Viewer({ specUrl }: { specUrl: string }) {
  return <iframe title="Workspace API reference" src={specUrl} className="min-h-[600px] w-full rounded border" />
}

export function OpenApiViewer({ workspaceId, specVersion }: Props) {
  const specUrl = `/v1/workspaces/${workspaceId}/openapi?format=json&specVersion=${encodeURIComponent(specVersion)}`

  return (
    <Suspense fallback={<div>Loading API reference…</div>}>
      <Viewer specUrl={specUrl} />
    </Suspense>
  )
}
