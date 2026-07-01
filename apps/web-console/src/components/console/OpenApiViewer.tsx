import { Suspense } from 'react'

interface Props {
  workspaceId: string
  specVersion: string
}

function Viewer({ specUrl }: { specUrl: string }) {
  return <iframe title="Referencia de API del área de trabajo" src={specUrl} className="min-h-[600px] w-full rounded border" />
}

export function OpenApiViewer({ workspaceId, specVersion }: Props) {
  const specUrl = `/v1/workspaces/${workspaceId}/openapi?format=json&specVersion=${encodeURIComponent(specVersion)}`

  return (
    <Suspense fallback={<div>Cargando referencia de API…</div>}>
      <Viewer specUrl={specUrl} />
    </Suspense>
  )
}
