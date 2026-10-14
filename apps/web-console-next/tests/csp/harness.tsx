// A separate entry included only by CSP_TEST_HARNESS=true, never the app router.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { RouteObject } from 'react-router-dom'
import { ReactFlow } from '@xyflow/react'
import { LayoutDashboard } from 'lucide-react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { configureMonacoYaml } from 'monaco-yaml'
import { appRoutes } from '../../src/router'
import { installMonacoEnvironment } from '../../src/lib/monaco-environment'
import '@fontsource/geist-sans/latin-400.css'
import '@fontsource/geist-mono/latin-400.css'
import '@xyflow/react/dist/style.css'
import '../../src/styles.css'

// Paths come from the actual runtime RouteObjects, including mapped children.
function concretePaths(routes: RouteObject[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const path = route.path?.startsWith('/') ? route.path : `${parent}/${route.path || ''}`
    const normalized = path.replace(/\/{2,}/g, '/') || '/'
    const sample = normalized.replace(/:([\w]+)/g, 'sample-$1').replace(/\*/g, 'sample-not-found')
    return [
      ...(route.path !== undefined || route.index ? [sample] : []),
      ...concretePaths(route.children || [], normalized)
    ]
  })
}
const paths = [...new Set(concretePaths(appRoutes))]
installMonacoEnvironment()

function Harness() {
  const yamlRef = useRef<HTMLDivElement>(null)
  const diffRef = useRef<HTMLDivElement>(null)
  const [yamlReady, setYamlReady] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  useEffect(() => {
    const yaml = configureMonacoYaml(monaco, { validate: true, enableSchemaRequest: false, schemas: [] })
    const model = monaco.editor.createModel('greeting: [', 'yaml', monaco.Uri.parse('inmemory://csp/example.yaml'))
    const markers = monaco.editor.onDidChangeMarkers(() => {
      if (monaco.editor.getModelMarkers({ resource: model.uri }).some((marker) => marker.severity === monaco.MarkerSeverity.Error)) setYamlReady(true)
    })
    const editor = monaco.editor.create(yamlRef.current!, { model, automaticLayout: true, minimap: { enabled: false } })
    const original = monaco.editor.createModel('before\n', 'plaintext')
    const modified = monaco.editor.createModel('after\n', 'plaintext')
    const diff = monaco.editor.createDiffEditor(diffRef.current!, { automaticLayout: true })
    const updates = diff.onDidUpdateDiff(() => { if (diff.getLineChanges()?.length) setEditorReady(true) })
    diff.setModel({ original, modified })
    return () => {
      updates.dispose(); markers.dispose(); editor.dispose(); diff.dispose()
      model.dispose(); original.dispose(); modified.dispose(); yaml.dispose()
    }
  }, [])
  return (
    <main className="p-6">
      <h1>CSP assets</h1>
      <code data-testid="mono" className="font-mono">Geist Mono self-hosted</code>
      <LayoutDashboard role="img" aria-label="Harness icon" />
      <p data-testid="yaml-status">{yamlReady ? 'YAML worker ready' : 'Waiting for YAML worker'}</p>
      <p data-testid="editor-status">{editorReady ? 'Editor worker ready' : 'Waiting for editor worker'}</p>
      <div ref={yamlRef} className="h-64 w-full" />
      <div ref={diffRef} className="h-64 w-full" />
      <div className="h-64 w-full">
        <ReactFlow nodes={[{ id: 'local', position: { x: 0, y: 0 }, data: { label: 'Local canvas' } }]} edges={[]} fitView />
      </div>
      <nav aria-label="Routes under test">
        {paths.map((path) => <a key={path} data-app-route href={import.meta.env.BASE_URL + path.replace(/^\//, '')}>{path}</a>)}
      </nav>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
