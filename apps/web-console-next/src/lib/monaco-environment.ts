import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import YamlWorker from 'monaco-yaml/yaml.worker?worker'

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
