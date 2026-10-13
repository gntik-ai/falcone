import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const version = /^(?:[0-9]+\.[0-9]+\.[0-9]+|dev)$/.test(process.env.VITE_APP_VERSION ?? '')
  ? process.env.VITE_APP_VERSION!
  : 'dev'
const commitSha = /^(?:[0-9a-f]{40}|[0-9a-f]{7})$/.test(process.env.VITE_APP_COMMIT_SHA ?? '')
  ? process.env.VITE_APP_COMMIT_SHA!
  : ''
const escapedVersion = version.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]!)

export default defineConfig(({ mode }) => ({
  plugins: [react(), {
    name: 'console-build-version',
    transformIndexHtml(html) {
      return html.replace(/<meta name="version" content="[^"]*"\s*\/>/, `<meta name="version" content="${escapedVersion}" />`)
    }
  }],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    // Tests supply release or local constants at the UI seam; production values stay JSON encoded.
    __APP_VERSION__: mode === 'test' ? 'globalThis.__APP_VERSION__' : JSON.stringify(version),
    __APP_COMMIT_SHA__: mode === 'test' ? 'globalThis.__APP_COMMIT_SHA__' : JSON.stringify(commitSha)
  },
  // Vite 6 worker output format: ES modules so monaco-yaml's yaml.worker and Monaco's
  // editor.worker (instantiated via `new Worker(new URL(...), { type: 'module' })`) are
  // emitted as resolvable, hashed worker bundles in production.
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Isolate Monaco + monaco-yaml into a dedicated, lazily-loaded chunk. The flows
        // YAML editor pulls this chunk in only via a dynamic import() (React.lazy in
        // FlowYamlEditor), so the console's main entry bundle never statically references
        // Monaco's ~2 MB footprint.
        //
        // Measured bundle impact (vite build, 2026-06 — add-console-flow-yaml-editor):
        //   monaco-chunk    : 4,270 kB raw / ~1,102 kB gzip  (monaco-editor + monaco-yaml)
        //   monaco-chunk.css :  147 kB raw /    ~23 kB gzip
        //   MonacoYamlSurface:  1.6 kB                         (the React.lazy boundary)
        //   yaml.worker      :  972 kB | editor.worker 253 kB | semantic-worker 248 kB
        //   index (entry)    :  674 kB raw / ~175 kB gzip      (UNCHANGED — no monaco preload)
        // The monaco-chunk is reachable ONLY via FlowYamlEditor's dynamic import() and is NOT
        // referenced by the index entry chunk's static import graph nor preloaded by index.html.
        manualChunks(id: string) {
          // Keep Vite's tiny `__vitePreload` runtime helper in its OWN chunk so Rollup does
          // not co-locate it inside monaco-chunk. If the helper landed in monaco-chunk, every
          // lazy route that performs a dynamic import would statically import the helper from
          // monaco-chunk — which would drag the 1 MB+ Monaco chunk into the initial preload
          // graph and defeat the code-split. Pinning the helper here keeps monaco-chunk a pure
          // leaf vendor chunk reachable ONLY via FlowYamlEditor's dynamic import().
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) {
            return 'vite-helpers'
          }
          if (id.includes('monaco-editor') || id.includes('monaco-yaml')) {
            return 'monaco-chunk'
          }
          return undefined
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/pages/**/*.tsx',
        'src/components/console/wizards/*.tsx',
        'src/components/console/DestructiveConfirmationDialog.tsx',
        'src/components/console/ConnectionSnippets.tsx',
        'src/lib/console-wizards.ts',
        'src/lib/destructive-ops.ts',
        'src/lib/snippets/*.ts'
      ]
    }
  }
}))
