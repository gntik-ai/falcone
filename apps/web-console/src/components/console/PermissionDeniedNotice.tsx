// Shared permission-denied surface (#761). Built on `ConsolePageState kind="blocked"` (already
// `role="alert"`) so every permission denial in the console — a wizard pre-gate, a hidden CTA's
// defense-in-depth fallback, or an actual backend 403 — renders with the SAME visual and copy
// contract instead of each call site inventing its own raw-error banner.
import { ConsolePageState } from '@/components/console/ConsolePageState'

const DEFAULT_TITLE = 'Acción restringida'

export function PermissionDeniedNotice({
  title = DEFAULT_TITLE,
  reason
}: {
  title?: string
  reason: string
}) {
  return <ConsolePageState kind="blocked" title={title} description={reason} />
}
