import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { revokeSecretVersion } from '@/actions/secretRotationActions'

function SecretVersionBadge({ state }: { state: string }) {
  const className = useMemo(() => {
    switch (state) {
      case 'active':
        return 'rounded bg-green-100 px-2 py-1 text-xs text-green-800'
      case 'grace':
        return 'rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-800'
      case 'revoked':
        return 'rounded bg-red-100 px-2 py-1 text-xs text-red-800'
      default:
        return 'rounded bg-gray-100 px-2 py-1 text-xs text-gray-800'
    }
  }, [state])

  return <span className={className}>{state}</span>
}

function RevokeDialog({ item, onClose }: { item: any; onClose: () => void }) {
  const [justification, setJustification] = useState('')
  const [forceRevoke, setForceRevoke] = useState(Boolean(item?.requiresForce))

  if (!item) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded bg-white p-4 shadow">
        <h2 className="text-lg font-semibold">Revocar versión del secreto</h2>
        {item.requiresForce ? <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Advertencia: esto revocaría la última versión válida.</div> : null}
        <textarea className="mt-3 w-full rounded border p-2" value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="¿Por qué se necesita esta revocación?" />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={forceRevoke} onChange={(event) => setForceRevoke(event.target.checked)} />
          Forzar revocación
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border px-3 py-2" onClick={onClose}>Cancelar</button>
          <button className="rounded bg-red-600 px-3 py-2 text-white" onClick={async () => {
            await revokeSecretVersion(item.secretPath, item.vaultVersion, { justification, forceRevoke })
            onClose()
          }}>Confirmar revocación</button>
        </div>
      </div>
    </div>
  )
}

export function ConsoleSecretsPage() {
  const navigate = useNavigate()
  const [dialogItem, setDialogItem] = useState<any | null>(null)
  const [items] = useState([
    { secretPath: 'platform/postgresql/app-password', name: 'app-password', domain: 'platform', tenant: '—', state: 'active', lastRotated: '2026-03-31T00:00:00Z', vaultVersion: 2, requiresForce: false },
    { secretPath: 'tenant/tenant-a/db-password', name: 'db-password', domain: 'organización', tenant: 'org-a', state: 'grace', lastRotated: '2026-03-30T12:00:00Z', vaultVersion: 1, requiresForce: true }
  ])

  return (
    <section className="space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Rotación de secretos</h1>
        <p className="text-sm text-slate-600">Plano de rotación de secretos de plataforma y organización: inventario de versiones, historial de rotación y flujo de revocación seguro. Los secretos de funciones del área de trabajo se gestionan en la pantalla Secretos del área de trabajo.</p>
      </header>
      <div className="overflow-hidden rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Dominio</th>
              <th className="px-3 py-2">Organización</th>
              <th className="px-3 py-2">Estado de versión</th>
              <th className="px-3 py-2">Última rotación</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.secretPath} className="border-t">
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2">{item.domain}</td>
                <td className="px-3 py-2">{item.tenant}</td>
                <td className="px-3 py-2"><SecretVersionBadge state={item.state} /></td>
                <td className="px-3 py-2">{item.lastRotated}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button className="rounded border px-2 py-1" onClick={() => navigate(`/console/secrets/${encodeURIComponent(item.secretPath)}/rotate`)}>Rotar</button>
                    <button className="rounded border px-2 py-1" onClick={() => navigate(`/console/secrets/${encodeURIComponent(item.secretPath)}/rotate`)}>Historial</button>
                    <button className="rounded border px-2 py-1" onClick={() => setDialogItem(item)}>Revocar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RevokeDialog item={dialogItem} onClose={() => setDialogItem(null)} />
    </section>
  )
}

export { SecretVersionBadge }
