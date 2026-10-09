export interface Invitation {
  id: string
  role: string
  workspaceId: string | null
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: string
  createdAt: string
}
export interface InvitationProof extends Invitation { token: string; entityId?: string }

// Fragments stay in the browser; the proof is sent only in the acceptance POST body.
export function invitationLink(tenantId: string, invitationId: string, token: string): string {
  return `${window.location.origin}/invitations/${encodeURIComponent(tenantId)}/${encodeURIComponent(invitationId)}#token=${encodeURIComponent(token)}`
}
