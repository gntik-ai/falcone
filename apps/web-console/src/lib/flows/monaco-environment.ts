// Monaco worker wiring (change: add-console-flow-yaml-editor).
//
// Monaco's language services run in dedicated Web Workers. Under Vite 6 the canonical way to
// hand Monaco its worker bundles is `MonacoEnvironment.getWorker`, instantiating each worker
// with `new Worker(new URL(...), { type: 'module' })` so Vite emits resolvable, hashed module
// workers (vite.config.ts `worker.format: 'es'`). monaco-yaml ships its own `yaml.worker`;
// every other label falls back to Monaco's generic `editor.worker`.
//
// This module is imported ONLY from the lazily-loaded Monaco surface, so the worker URLs (and
// therefore Monaco itself) never enter the main entry chunk's static import graph.

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import YamlWorker from 'monaco-yaml/yaml.worker?worker'

let installed = false

// Idempotently register the worker factory on the global MonacoEnvironment.
export function installMonacoEnvironment(): void {
  if (installed) return
  installed = true
  ;(globalThis as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'yaml') {
        return new YamlWorker()
      }
      return new EditorWorker()
    }
  }
}
