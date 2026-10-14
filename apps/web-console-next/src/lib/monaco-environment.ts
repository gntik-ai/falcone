import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import YamlWorker from 'monaco-yaml/yaml.worker?worker'
import { configureMonacoYaml, type MonacoYamlOptions } from 'monaco-yaml'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js'

export function configureLocalMonacoYaml(monaco: typeof Monaco, options: MonacoYamlOptions) {
  // monaco-worker-manager 2.x supplies moduleId/createData, while Monaco >=0.54
  // requires an explicit worker. Adapt only the API passed to monaco-yaml.
  const yamlMonaco = {
    ...monaco,
    editor: {
      ...monaco.editor,
      createWebWorker<T extends object>(legacyOptions: { createData: unknown }) {
        const worker = new YamlWorker()
        // monaco-yaml's bootstrap consumes a first message, then its settings.
        // Send both before Monaco starts its model-sync/RPC protocol.
        worker.postMessage(null)
        worker.postMessage(legacyOptions.createData)
        return monaco.editor.createWebWorker<T>({ worker })
      }
    }
  }
  // monaco-types resolves a different Monaco peer in this workspace; the YAML
  // integration uses the same public language/model APIs, adapted above.
  return configureMonacoYaml(yamlMonaco as unknown as Parameters<typeof configureMonacoYaml>[0], options)
}

// Import this before mounting a Monaco surface. Vite emits both workers locally.
export function installMonacoEnvironment(): void {
  Object.assign(globalThis, {
    MonacoEnvironment: {
      getWorker(_workerId: string, label: string) {
        return label === 'yaml' ? new YamlWorker() : new EditorWorker()
      }
    }
  })
}
