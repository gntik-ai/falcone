import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import router from '@/router'
// #734: brand typeface. Self-hosted (bundled into the app build, no runtime CDN fetch — works
// fully offline/air-gapped) via the @fontsource-variable/inter package; only the non-italic
// weight axis (100-900) is imported since the console never uses italics. Wired through
// tailwind.config.ts's `fontFamily.sans` so it's picked up tree-wide, not just here.
import '@fontsource-variable/inter/wght.css'
import '@/styles/globals.css'

declare const __APP_VERSION__: string

const versionMeta = document.querySelector('meta[name="version"]')
if (versionMeta) {
  versionMeta.setAttribute('content', __APP_VERSION__)
}

console.info('In Falcone Console', __APP_VERSION__)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
