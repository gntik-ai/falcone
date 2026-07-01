import type { WorkspaceDocsResponse } from '@/lib/console-workspace-docs'

interface Props {
  authInstructions: WorkspaceDocsResponse['authInstructions']
}

export function WorkspaceDocAuthSection({ authInstructions }: Props) {
  return (
    <section aria-label="Instrucciones de autenticación" className="space-y-2 rounded-lg border p-4 break-words">
      <h2 className="text-lg font-semibold">Autenticación</h2>
      <p>Método: <strong>{authInstructions.method}</strong></p>
      {authInstructions.tokenEndpoint ? (
        <p>Punto de conexión de token: <span className="break-all">{authInstructions.tokenEndpoint}</span></p>
      ) : null}
      <p>ID del cliente: <span className="break-all">{authInstructions.clientIdPlaceholder}</span></p>
      <p>Secreto del cliente: <span className="break-all">{authInstructions.clientSecretPlaceholder}</span></p>
      <p>Alcances: <span className="break-words">{authInstructions.scopeHint}</span></p>
      <p>Referencia en consola: <span className="break-words">{authInstructions.consoleRef}</span></p>
    </section>
  )
}
