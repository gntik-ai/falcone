import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: env.VITE_BASE_PATH ?? '/next/',
    plugins: [react(), tailwindcss()],
    // Keep the legacy app's Tailwind 3 PostCSS configuration outside this build.
    css: { postcss: { plugins: [] } },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      maxWorkers: 2
    }
  }
})
