import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { AUTH_PANEL_CLASS_NAME, AUTH_PANEL_HEADING_CLASS_NAME } from '@/lib/console-auth-surface'

export function NotFoundPage() {
  return (
    <section className={`${AUTH_PANEL_CLASS_NAME} text-center`}>
      <p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">404</p>
      <h1 className={`${AUTH_PANEL_HEADING_CLASS_NAME} mt-4`}>Página no encontrada</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">
        La ruta solicitada no existe todavía en la consola administrativa. Puedes volver al punto de entrada
        principal y continuar desde allí.
      </p>
      <div className="mt-8 flex justify-center">
        <Button asChild variant="secondary">
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    </section>
  )
}
