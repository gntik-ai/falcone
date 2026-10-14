import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss(), {
      name: 'console-build-version',
      transformIndexHtml(html) {
        return html.replace(/<meta name="version" content="[^"]*"\s*\/>/, `<meta name="version" content="${escapedVersion}" />`)
      }
    }],
    define: {
      __APP_VERSION__: mode === 'test' ? 'globalThis.__APP_VERSION__' : JSON.stringify(version),
      __APP_COMMIT_SHA__: mode === 'test' ? 'globalThis.__APP_COMMIT_SHA__' : JSON.stringify(commitSha)
    },
    worker: { format: 'es' },
    build: {
      rollupOptions: {
        input: {
          app: fileURLToPath(new URL('./index.html', import.meta.url)),
          ...(process.env.CSP_TEST_HARNESS === 'true' ? {
            harness: fileURLToPath(new URL('./tests/csp/index.html', import.meta.url))
          } : {})
        },
        output: {
          manualChunks(id: string) {
            if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) return 'vite-helpers'
            if (id.includes('monaco-editor') || id.includes('monaco-yaml')) return 'monaco-chunk'
          }
        }
      }
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']
    }
  }
})
