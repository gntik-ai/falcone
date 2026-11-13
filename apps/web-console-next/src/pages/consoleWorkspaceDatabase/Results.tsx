import { Collapsible, CollapsiblePanel, CollapsibleTrigger, Field, FieldLabel, SecretField, Text } from '@gntik-ai/ui'
import { InlineCallout } from '@gntik-ai/blocks'
import type { DatabaseConnection, RotateResponse } from '@in-falcone/console-api/clients'
import { focusRing, notRotatedKey, useCopy } from './copy'

function TechnicalDetail({ text }: { text: string | null | undefined }) {
  const { t } = useCopy()
  return text ? <Collapsible defaultOpen={false} variant="subtle" className="min-w-0"><CollapsibleTrigger showChevron={true} className={focusRing}>{t('details')}</CollapsibleTrigger><CollapsiblePanel keepMounted={false} className="min-w-0 wrap-anywhere"><Text as="p" variant="body" tone="muted">{text}</Text></CollapsiblePanel></Collapsible> : null
}
function Secret({ value, name }: { value: string; name: 'dsn' | 'password' }) {
  const { t } = useCopy()
  return <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor={`database-${name}`}>{t(name)}</FieldLabel>
    <SecretField key={value} id={`database-${name}`} data-testid={`database-${name}`} value={value} size="md" editable={false} onValueChange={undefined} revealed={undefined} defaultRevealed={false} onRevealedChange={undefined} copyable={true} showLabel={t('show')} hideLabel={t('hide')} copyLabel={t('copy')} copiedAnnouncement={t('copied')} onRotate={undefined} confirmRotate={false} rotateLabel="" rotateTitle="" rotateDescription="" rotateConfirmLabel="" createdAt={undefined} lastUsedAt={undefined} visiblePrefix={0} visibleSuffix={0} maskLength={16} disabled={false} wrapperClassName="min-w-0" className={focusRing} />
  </Field>
}
export function Result({ connection, rotation }: { connection: DatabaseConnection | null; rotation: RotateResponse | null }) {
  const { t } = useCopy()
  if (!connection && !rotation) return null
  const title = t(connection ? 'connectionTitle' : 'rotationTitle')
  const message = connection ? t(connection.password ? 'connectionWarning' : 'shared') : t(rotation!.rotated ? 'rotationWarning' : notRotatedKey(rotation!.mode, rotation!.reason))
  const value = connection ?? rotation!
  return <section tabIndex={-1} data-database-result="" aria-label={title} className={`min-w-0 space-y-3 ${focusRing}`}>
    <InlineCallout tone="warning" title={title} description={message} actions={[]} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title, description: message, upgrade: '', viewUsage: '' }} />
    {(connection || rotation?.rotated) && value.dsn && <Secret value={value.dsn} name="dsn" />}
    {(connection || rotation?.rotated) && value.password && <Secret value={value.password} name="password" />}
    <TechnicalDetail key={connection ? 'connection' : 'rotation'} text={connection?.passwordHint ?? rotation?.reason} />
  </section>
}
