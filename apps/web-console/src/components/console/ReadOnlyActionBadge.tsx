// Shared read-only affordance styling for permission-aware surfaces (#761).
//
// Single source of truth for the "read-only / caution" amber tone so the identity-zone role badge,
// the page-level CTA-replacement badges (Flows / Members / Workspaces) and the ServiceAccounts
// disable-with-reason notice never drift into subtly different ambers.
//
// The tone is authored directly for the console's dark `:root` (the app never toggles `.dark`, so a
// `dark:` variant would be dead code — mirroring getConsoleContextStatusBadgeClasses('warning') and
// the alert.tsx warning variant): light `-300` amber text on an amber `/10` tint reads at ~11:1 on
// the near-black background, whereas a bare `text-amber-700` base rendered dark-on-dark (~3.4:1,
// below WCAG AA).
import { Lock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Amber "read-only / caution" chip tone (border + tint + text) for badge affordances. */
export const READ_ONLY_AFFORDANCE_BADGE_TONE = 'border-amber-500/40 bg-amber-500/10 text-amber-300'

/** Amber "read-only / caution" text tone for inline/paragraph affordances that carry no chip. */
export const READ_ONLY_AFFORDANCE_TEXT_TONE = 'text-amber-300'

/**
 * CTA-replacement badge shown in place of a create action a role cannot use. Renders the shared
 * amber chip with a Lock cue and the localized "Solo lectura · tu rol (…) no puede …" copy, mirroring
 * the recourse (`reason`) both to pointer users via `title` and to assistive tech via an sr-only
 * child so keyboard/touch/screen-reader users get the same guidance.
 */
export function ReadOnlyActionBadge({
  roleLabel,
  deniedAction,
  reason,
  testId,
  className
}: {
  /** Humanized highest role, e.g. "Viewer · solo lectura". */
  roleLabel: string
  /** Verb phrase for what the role cannot do, e.g. "crear flujos". */
  deniedAction: string
  /** Role-aware recourse; shown to pointer users via `title` and to assistive tech via sr-only. */
  reason?: string | null
  testId?: string
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      title={reason ?? undefined}
      className={cn('gap-1.5', READ_ONLY_AFFORDANCE_BADGE_TONE, className)}
    >
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Solo lectura · tu rol ({roleLabel}) no puede {deniedAction}
      </span>
      {reason ? <span className="sr-only">{' '}{reason}</span> : null}
    </Badge>
  )
}
