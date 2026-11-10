import type { WorkspaceSecret } from './api'
import { readSecretName } from './api'

// Focus destinations are resolved from the DOM by data attributes because the dialogs are portalled and
// the rows are rendered by the kit data table.
export const SECTION_TITLE_ID = 'workspace-secrets-section-title'
export type Intent =
  | { kind: 'name' }
  | { kind: 'row'; action: 'replace' | 'delete'; name: string }
  | { kind: 'replace-success'; name: string }
  | { kind: 'section' }
  | { kind: 'first-new-row'; name: string }
  | { kind: 'state'; target: 'list' | 'create' | 'table' | 'blocked' }
  | { kind: 'retry'; target: 'list' | 'next' | 'create' | 'confirm' }
  | { kind: 'replace-submit' }

// Intents that need the reloaded list to settle before they can be resolved.
export const needsList = (intent: Intent) => ['replace-success', 'section', 'first-new-row'].includes(intent.kind)

const query = (selector: string) => document.querySelector<HTMLElement>(selector)
const headingOf = (root: HTMLElement | null) => {
  const heading = root?.querySelector<HTMLElement>('h1, h2, h3') ?? null
  if (heading) heading.tabIndex = -1
  return heading
}
// The error panel also holds a copy-identifier button and a details disclosure; Reintentar has neither.
const retryButton = (root: HTMLElement | null) => root?.querySelector<HTMLElement>('button:not([aria-expanded]):not([aria-label]):not(:disabled)') ?? null
const section = () => {
  const title = document.getElementById(SECTION_TITLE_ID)
  if (title) title.tabIndex = -1
  return title
}
// After a write whose reload failed, neither the table nor the empty state exists: the failure panel's heading is the landmark,
// or the blocked state's heading when the reload returned 501.
const listFailure = () => headingOf(query('[data-secret-failure="list"]')) ?? headingOf(query('[data-secret-state="list"]')) ?? headingOf(query('[data-secret-state="blocked"]'))
const rowAction = (action: string, name: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-secret-action="${action}"]`)).find((element) => element.dataset.secretName === name) ?? null

export function resolveIntent(intent: Intent, rows: readonly WorkspaceSecret[]): HTMLElement | null {
  switch (intent.kind) {
    case 'name': return query('[data-secret-field="name"]')
    case 'row': return rowAction(intent.action, intent.name)
    case 'replace-success':
      return rows.some((row) => readSecretName(row) === intent.name) ? rowAction('replace', intent.name) : section() ?? headingOf(query('[data-secret-state="empty"]')) ?? listFailure()
    case 'section': return section() ?? headingOf(query('[data-secret-state="empty"]')) ?? listFailure()
    case 'first-new-row': {
      const cell = Array.from(document.querySelectorAll<HTMLElement>('[data-secret-row-header]')).find((element) => element.dataset.secretRowHeader === intent.name) ?? null
      if (cell) cell.tabIndex = -1
      return cell
    }
    case 'state': return headingOf(query(`[data-secret-state="${intent.target}"]`))
    case 'retry': return retryButton(query(`[data-secret-failure="${intent.target}"]`))
    case 'replace-submit': return query('[data-secret-field="replace-submit"]')
  }
}
