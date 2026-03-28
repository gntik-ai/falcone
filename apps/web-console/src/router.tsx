import { createBrowserRouter } from 'react-router-dom'

import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PendingActivationPage } from '@/pages/PendingActivationPage'
import { SignupPage } from '@/pages/SignupPage'
import { WelcomePage } from '@/pages/WelcomePage'

// T03 añade signup y activación pendiente. Las rutas con shell y protección llegarán en T05.
export const appRoutes = [
  {
    path: '/',
    element: <WelcomePage />
  },
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/signup',
    element: <SignupPage />
  },
  {
    path: '/signup/pending-activation',
    element: <PendingActivationPage />
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]

const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(appRoutes)

export default router
