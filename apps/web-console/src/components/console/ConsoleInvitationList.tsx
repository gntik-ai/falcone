import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { InvitationProofView } from './InvitationProofView'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { Invitation, InvitationProof } from '@/lib/invitations'

export function ConsoleInvitationList({ tenantId, reloadKey }: { tenantId: string; reloadKey: number }) {
  const [items, setItems] = useState<Invitation[]>([])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resendId, setResendId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [proof, setProof] = useState<InvitationProof | null>(null)
  const base = `/v1/tenants/${encodeURIComponent(tenantId)}/invitations`

  useEffect(() => {
    setItems([]); setProof(null); setEmail(''); setResendId(null)
  }, [tenantId])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    requestConsoleSessionJson<{ items: Invitation[] }>(base).then(response => {
      if (!cancelled) setItems(response.items)
    }).catch(() => { if (!cancelled) setError('No se pudieron cargar las invitaciones.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [base, reloadKey, revision])

  async function revoke(id: string) {
    setBusy(true); setError('')
    try {
      await requestConsoleSessionJson(`${base}/${encodeURIComponent(id)}/revocation`, { method: 'POST', body: {} })
      setRevision(value => value + 1)
    } catch { setError('No se pudo revocar la invitación.') }
    finally { setBusy(false) }
  }
  async function resend(event: FormEvent) {
    event.preventDefault()
    if (!resendId) return
    setBusy(true); setError('')
    try {
      const response = await requestConsoleSessionJson<InvitationProof>(`${base}/${encodeURIComponent(resendId)}/resend`, { method: 'POST', body: { email } })
      setProof(response); setEmail(''); setResendId(null); setRevision(value => value + 1)
    } catch { setError('No se pudo reenviar la invitación. Comprueba el email.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-3xl border p-6" aria-label="Invitaciones">
    <h2 className="text-lg font-semibold">Invitaciones</h2>
    {loading ? <p>Cargando invitaciones…</p> : null}
    {error ? <p role="alert">{error}<Button onClick={() => setRevision(value => value + 1)}>Reintentar</Button></p> : null}
    {!loading && !error && items.length === 0 ? <p>No hay invitaciones.</p> : null}
    <Table><TableHeader><TableRow><TableHead>Invitación</TableHead><TableHead>Rol</TableHead><TableHead>Área de trabajo</TableHead><TableHead>Estado</TableHead><TableHead>Caduca</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
      <TableBody>{items.map(invitation => <TableRow key={invitation.id}>
        <TableCell>{invitation.id}</TableCell><TableCell>{invitation.role}</TableCell><TableCell>{invitation.workspaceId ?? 'Organización'}</TableCell><TableCell>{invitation.status}</TableCell><TableCell>{new Date(invitation.expiresAt).toLocaleString()}</TableCell>
        <TableCell>{invitation.status === 'pending' ? <Button disabled={busy} aria-label={`Revocar ${invitation.id}`} onClick={() => void revoke(invitation.id)}>Revocar</Button> : null}
          {invitation.status !== 'accepted' ? <Button disabled={busy} aria-label={`Reenviar ${invitation.id}`} onClick={() => { setResendId(invitation.id); setEmail(''); setProof(null) }}>Reenviar</Button> : null}</TableCell>
      </TableRow>)}</TableBody></Table>
    {resendId ? <form onSubmit={event => void resend(event)} className="space-y-2">
      <Label htmlFor="invitation-resend-email">Email de la invitación</Label><Input id="invitation-resend-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} />
      <Button type="submit" disabled={busy}>Generar enlace nuevo</Button><Button type="button" onClick={() => { setResendId(null); setEmail('') }}>Cancelar</Button>
    </form> : null}
    {proof ? <><InvitationProofView tenantId={tenantId} invitationId={proof.id} token={proof.token} expiresAt={proof.expiresAt} /><Button onClick={() => setProof(null)}>Ocultar enlace</Button></> : null}
  </section>
}
