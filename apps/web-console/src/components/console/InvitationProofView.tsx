import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invitationLink } from '@/lib/invitations'

export function InvitationProofView({ tenantId, invitationId, token, expiresAt }: { tenantId: string; invitationId: string; token: string; expiresAt: string }) {
  const inputId = useId()
  return <div className="space-y-2 rounded-xl border p-4">
    <Label htmlFor={inputId}>Enlace de un solo uso</Label>
    <Input id={inputId} readOnly value={invitationLink(tenantId, invitationId, token)} />
    <p>Copia este enlace y entrégalo al invitado. Se muestra solo ahora.</p>
    <p>Caduca: {new Date(expiresAt).toLocaleString()}</p>
  </div>
}
