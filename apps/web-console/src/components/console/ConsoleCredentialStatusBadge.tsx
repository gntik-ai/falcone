import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Color-encodes credential lifecycle state (#783). Follows the same dark-safe tone idiom as
// `ConsoleAuditResultBadge` and `getStatusBadgeClasses` in `ConsoleShellLayout.tsx`: emerald for a
// healthy/active credential, a distinct tone (violet) for rotated (not a failure, but no longer the
// live secret), red/destructive for revoked, and amber for expired. Anything outside this known set
// (including null/undefined) renders with the same neutral outline tone the badge always used.
const CREDENTIAL_STATUS_TONE: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rotated: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  revoked: 'border-destructive/30 bg-destructive/10 text-destructive',
  expired: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

const NEUTRAL_TONE = 'border-border bg-background text-muted-foreground'

export function ConsoleCredentialStatusBadge({ status }: { status: string | null | undefined }) {
  const tone = status ? (CREDENTIAL_STATUS_TONE[status] ?? NEUTRAL_TONE) : NEUTRAL_TONE
  return <Badge variant="outline" className={cn(tone)}>{status ?? 'Desconocido'}</Badge>
}
