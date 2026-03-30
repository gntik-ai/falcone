import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchWorkspaceSpec } from '@/lib/console-openapi-sdk'
import { SpecDownloadButton } from '@/components/console/SpecDownloadButton'
import { OpenApiViewer } from '@/components/console/OpenApiViewer'
import { SdkDownloadPanel } from '@/components/console/SdkDownloadPanel'

export default function ConsoleApiReferencePage() {
  const { workspaceId = '' } = useParams()
  const [specVersion, setSpecVersion] = useState('0.0.0')
  const [bannerVisible, setBannerVisible] = useState(false)
  const storageKey = useMemo(() => `lastSeenSpecVersion-${workspaceId}`, [workspaceId])

  useEffect(() => {
    let active = true
    void fetchWorkspaceSpec(workspaceId, 'json').then((spec) => {
      if (!active || !spec) return
      setSpecVersion(spec.specVersion)
      if (window.localStorage.getItem(storageKey) !== spec.specVersion) {
        setBannerVisible(true)
      }
    })
    return () => { active = false }
  }, [workspaceId, storageKey])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">API Reference</h1>
        <p>Download the workspace OpenAPI contract and generate SDKs.</p>
      </header>

      <SpecDownloadButton workspaceId={workspaceId} specVersion={specVersion} lastUpdated={new Date().toISOString()} />

      {bannerVisible ? (
        <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-4">
          <p>{`API contract updated to v${specVersion}`}</p>
          <button type="button" onClick={() => { window.localStorage.setItem(storageKey, specVersion); setBannerVisible(false) }}>Dismiss</button>
        </div>
      ) : null}

      <OpenApiViewer workspaceId={workspaceId} specVersion={specVersion} />
      <SdkDownloadPanel workspaceId={workspaceId} currentSpecVersion={specVersion} />
    </div>
  )
}
