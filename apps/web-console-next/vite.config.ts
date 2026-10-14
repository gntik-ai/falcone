import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
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
