import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusTag } from '@gntik-ai/ui'
import { failureOf, issueApiKey, listApiKeys, revokeApiKey, type ApiKeyRecord, type Failure, type IssuedApiKey, type Target } from './api'
import { Confirmation, ConfirmDestructiveDialog } from './Confirm'
import { useCopy } from './copy'
import { Action, FailureView, Heading, Loading, NoResults, Table } from './States'
import { RevealDialog } from './Reveal'

type KeysState = { busy: boolean; items: ApiKeyRecord[]; error: Failure | null }

// The API-key panel: list, issue (anon or service), one-time reveal and revoke. Issued keys stay in
// this component's state only; a new issue or leaving the page drops the held key.
// `refreshKey` changes whenever the rows read changes (target, page size, cursor or filters): the legacy
// editor re-reads the key list on every such change, so the panel does too.
export function KeysPanel({ target, refreshKey, report, notify }: { target: Target; refreshKey: string; report: (message: string | null) => void; notify: (message: string) => void }) {
  const { t } = useCopy()
  const workspaceId = target.workspaceId
  const [state, setState] = useState<KeysState>({ busy: true, items: [], error: null })
  const [issued, setIssued] = useState<{ key: IssuedApiKey; opener: HTMLElement | null; serial: number } | null>(null)
  const serial = useRef(0)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const generation = useRef(0), live = useRef(true)
  const load = useCallback(async () => {
    const token = ++generation.current
    setState((previous) => ({ ...previous, busy: true, error: null }))
    try {
      const result = await listApiKeys(workspaceId)
      if (live.current && generation.current === token) setState({ busy: false, items: result.items, error: null })
    } catch (cause) {
      if (live.current && generation.current === token) setState({ busy: false, items: [], error: failureOf(cause) })
    }
  }, [workspaceId])
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current++ } }, [load, refreshKey])
  const message = (cause: unknown) => failureOf(cause).message ?? t('mutationFailed')
  async function issue(keyType: 'anon' | 'service', opener: HTMLElement) {
    report(null)
    try {
      const key = await issueApiKey(workspaceId, keyType)
      setIssued({ key, opener, serial: ++serial.current })
      await load()
    } catch (cause) { report(message(cause)) }
  }
  function askRevoke(key: ApiKeyRecord, opener: HTMLElement) {
    setConfirmation({
      title: t('revokeTitle', { prefix: key.key_prefix }), description: t('revokeDescription'),
      consequences: [t('revokeConsequenceKey', { prefix: key.key_prefix }), t('revokeConsequenceUndo')],
      value: key.key_prefix, confirmLabel: t('revokeConfirm'), opener, testId: 'pgdata-revoke-dialog',
      run: async () => {
        try { await revokeApiKey(workspaceId, key.id); notify(t('revoked')); await load() }
        catch (cause) { report(message(cause)) }
      },
    })
  }
  const columns = [
    { id: 'prefix', header: t('keyPrefix'), sortable: false, cell: (row: ApiKeyRecord) => `${row.key_prefix}…` },
    { id: 'type', header: t('keyType'), sortable: false, cell: (row: ApiKeyRecord) => t(`keyTypes.${row.key_type}`, { defaultValue: row.key_type }) },
    { id: 'status', header: t('keyStatus'), sortable: false, cell: (row: ApiKeyRecord) => {
      const label = t(`keyStatuses.${row.status}`, { defaultValue: row.status })
      return <StatusTag status={row.status} statuses={{ [row.status]: { label, tone: row.status === 'active' ? 'success' : 'neutral' } }} label={label} uppercase={false} variant="soft" size="sm" shape="rounded" className="max-w-full" />
    } },
    { id: 'actions', header: t('columnActions'), sortable: false, cell: (row: ApiKeyRecord) => row.status === 'active' ? <Action variant="destructive" onClick={(event) => askRevoke(row, event.currentTarget)}>{t('revokeAction')}</Action> : null },
  ]
  return <section aria-label={t('keysTitle')} aria-busy={state.busy} className="min-w-0 space-y-4" data-testid="pgdata-keys">
    <Heading title={t('keysTitle')} description={t('keysDescription')} />
    <div className="flex flex-wrap gap-2">
      <Action variant="primary" onClick={(event) => void issue('anon', event.currentTarget)}>{t('issueAnon')}</Action>
      <Action onClick={(event) => void issue('service', event.currentTarget)}>{t('issueService')}</Action>
    </div>
    {state.busy ? <Loading label={t('keysLoading')} />
      : state.error ? <FailureView error={state.error} section={t('keysTitle')} message="keysError" retry={() => void load()} testId="pgdata-failure-keys" />
      : state.items.length ? <Table rows={state.items} columns={columns} id={(row) => row.id} label={t('keysTableLabel')} />
      : <NoResults title={t('keysEmpty')} description={t('keysEmptyDescription')} />}
    {issued && <RevealDialog key={issued.serial} issued={issued.key} target={target} opener={issued.opener} close={() => setIssued(null)} />}
    {confirmation && <ConfirmDestructiveDialog confirmation={confirmation} close={() => setConfirmation(null)} />}
  </section>
}
