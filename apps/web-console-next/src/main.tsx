import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { setConsoleSessionRetry401Invalidation } from '@in-falcone/console-api/session'

import { App } from './App'
import { routerBasename } from './router'
import '@fontsource/geist-sans/latin-400.css'
import '@fontsource/geist-sans/latin-600.css'
import '@fontsource/geist-mono/latin-400.css'
import './styles.css'

setConsoleSessionRetry401Invalidation(true)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>
)
