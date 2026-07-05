// #757: converged onto the shared Card/Table/Button/Textarea/Badge primitives. This page
// previously rendered a hard-coded solid-white panel (a light-mode card leaking onto the dark
// console theme) and a hand-rolled <table> with its own one-off header styling.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { revokeSecretVersion } from '@/actions/secretRotationActions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

function SecretVersionBadge({ state }: { state: string }) {
  const variant = useMemo(() => {
    switch (state) {
      case 'active':
        return 'secondary' as const
      case 'grace':
        return 'outline' as const
      case 'revoked':
        return 'destructive' as const
      default:
        return 'outline' as const
    }
  }, [state])

  return <Badge variant={variant}>{state}</Badge>
}

function RevokeDialog({ item, onClose }: { item: any; onClose: () => void }) {
  const [justification, setJustification] = useState('')
  const [forceRevoke, setForceRevoke] = useState(Boolean(item?.requiresForce))

  if (!item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()}>
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Revocar versión del secreto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {item.requiresForce ? (
              <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Advertencia: esto revocaría la última versión válida.
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="revoke-justification">Justificación</Label>
              <Textarea
                id="revoke-justification"
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="¿Por qué se necesita esta revocación?"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={forceRevoke} onChange={(event) => setForceRevoke(event.target.checked)} />
              Forzar revocación
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  await revokeSecretVersion(item.secretPath, item.vaultVersion, { justification, forceRevoke })
                  onClose()
                }}
              >
                Confirmar revocación
              </Button>
            </div>
          </CardContent>
        </Card>
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
    <section className="space-y-6" aria-label="Rotación de secretos">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Rotación de secretos</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Plano de rotación de secretos de plataforma y organización: inventario de versiones, historial de rotación y flujo de
          revocación seguro. Los secretos de funciones del área de trabajo se gestionan en la pantalla Secretos del área de
          trabajo.
        </p>
      </header>

      <Card>
        <CardContent className="mt-0">
          <Table aria-label="Listado de secretos de plataforma y organización">
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Dominio</TableHead>
                <TableHead>Organización</TableHead>
                <TableHead>Estado de versión</TableHead>
                <TableHead>Última rotación</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.secretPath}>
                  <TableCell className="font-medium text-foreground">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.domain}</TableCell>
                  <TableCell className="text-muted-foreground">{item.tenant}</TableCell>
                  <TableCell>
                    <SecretVersionBadge state={item.state} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.lastRotated}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/console/secrets/${encodeURIComponent(item.secretPath)}/rotate`)}>
                        Rotar
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/console/secrets/${encodeURIComponent(item.secretPath)}/rotate`)}>
                        Historial
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setDialogItem(item)}>
                        Revocar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <RevokeDialog item={dialogItem} onClose={() => setDialogItem(null)} />
    </section>
  )
}

export { SecretVersionBadge }
