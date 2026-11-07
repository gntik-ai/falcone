import { useCallback, useEffect, useRef, useState } from 'react'
import { Field, FieldLabel, Timestamp } from '@gntik-ai/ui'
import type { DataTableColumn } from '@gntik-ai/blocks'
import { listInvitations, resendInvitation, revokeInvitation, type Invitation, type Proof } from './api'
import { useCopy } from './copy'
import { Action, Control, Empty, Heading, Loading, Notice, ProofView, Table } from './ui'
import { useList } from './useList'

export function Invitations({ tenantId, reload }: { tenantId: string; reload: number }) {
  const { t, i18n: language } = useCopy()
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [resendId, setResendId] = useState<string | null>(null), [email, setEmail] = useState(''), [proof, setProof] = useState<Proof | null>(null)
  const active = useRef(true), lock = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const load = useCallback((signal: AbortSignal) => listInvitations(tenantId, signal), [tenantId])
  const result = useList(load, revision + reload)
  useEffect(() => { setError('') }, [reload])
  async function mutate(id: string, resend: boolean) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (resend) {
        const response = await resendInvitation(tenantId, id, email)
        if (!active.current) return
        setProof(response); setResendId(null); setEmail('')
      } else await revokeInvitation(tenantId, id)
      if (active.current) setRevision((value) => value + 1)
    } catch { if (active.current) setError(t(resend ? 'resendFailure' : 'revokeFailure')) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const columns: DataTableColumn<Invitation>[] = [
    { id: 'id', header: t('invitation'), sortable: false, cell: (row) => row.id },
    { id: 'role', header: t('role'), sortable: false, cell: (row) => row.role },
    { id: 'workspace', header: t('workspace'), sortable: false, cell: (row) => row.workspaceId ?? t('organization') },
    { id: 'status', header: t('status'), sortable: false, cell: (row) => t(`invitationStatus.${row.status}`) },
    { id: 'expiry', header: t('expiryColumn'), sortable: false, cell: (row) => <Timestamp value={row.expiresAt} locale={language.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('unavailable')} /> },
    { id: 'actions', header: t('actions'), sortable: false, cell: (row) => <div className="flex flex-wrap gap-2">{row.status === 'pending' && <Action disabled={busy} aria-label={t('revokeNamed', { id: row.id })} onClick={() => void mutate(row.id, false)}>{t('revoke')}</Action>}{row.status !== 'accepted' && <Action disabled={busy} aria-label={t('resendNamed', { id: row.id })} onClick={() => { setResendId(row.id); setEmail(''); setProof(null) }}>{t('resend')}</Action>}</div> },
  ]
  return <section className="min-w-0 space-y-4" aria-label={t('invitations')}>
    <Heading title={t('invitations')} />
    {result?.failure ? <><Notice message={t('invitationsFailure')} /><Action onClick={() => { setError(''); setRevision((value) => value + 1) }}>{t('retry')}</Action></> : !result?.rows ? <Loading label={t('invitationsLoading')} /> : result.rows.length ? <Table rows={result.rows} columns={columns} id={(row) => row.id} label={t('invitations')} /> : <Empty title={t('invitationsEmpty')} />}
    {error && <><Notice message={error} /><Action onClick={() => { setError(''); setRevision((value) => value + 1) }}>{t('retry')}</Action></>}
    {resendId && <form onSubmit={(event) => { event.preventDefault(); void mutate(resendId, true) }} className="space-y-3">
      <Field invalid={false}><FieldLabel required>{t('resendEmail')}</FieldLabel><Control type="email" required value={email} onValueChange={setEmail} disabled={busy} /></Field>
      <div className="flex flex-wrap gap-2"><Action type="submit" disabled={busy}>{t('generateLink')}</Action><Action onClick={() => { setResendId(null); setEmail('') }}>{t('cancel')}</Action></div>
    </form>}
    {proof && <ProofView tenantId={tenantId} proof={proof} onClose={() => setProof(null)} closeLabel={t('hideLink')} />}
  </section>
}
