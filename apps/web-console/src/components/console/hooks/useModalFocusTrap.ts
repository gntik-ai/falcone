import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

// Shared a11y primitive for the console's hand-rolled modals (the `ui/dialog.tsx` primitive is a
// bare backdrop + click-to-close overlay and provides none of this itself). Used by
// ConsoleWorkspaceSecretsPage's SecretDialog, DestructiveConfirmationDialog, and
// ConsoleServiceAccountsPage's CredentialDisclosureDialog so the Tab-trap + focus-return semantics
// live in exactly one place instead of being re-implemented per dialog.
export const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface UseModalFocusTrapOptions {
  // 'first' (default) moves focus to the first focusable descendant of the panel on open (or the
  // panel itself if there is none). 'panel' always focuses the panel container itself, regardless
  // of its focusable descendants — used where the panel is the accessible-name-bearing element and
  // callers rely on it (not a specific child) receiving focus on open.
  initialFocus?: 'first' | 'panel'
}

// Moves focus into the panel on open, keeps it cycling between the panel's focusable descendants
// on Tab/Shift+Tab, and returns focus to whatever had it before the panel opened (the trigger) once
// it closes. `open` drives the effect; `panelRef` must be attached to the panel's root element.
export function useModalFocusTrap<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  options: UseModalFocusTrapOptions = {}
) {
  const initialFocus = options.initialFocus ?? 'first'
  const panelRef = useRef<T | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    const panel = panelRef.current
    if (initialFocus === 'panel') {
      panel?.focus()
    } else {
      const first = panel?.querySelector<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)
      ;(first ?? panel)?.focus()
    }
    return () => {
      restoreFocusRef.current?.focus?.()
    }
  }, [open, initialFocus])

  function handleTabTrap(event: ReactKeyboardEvent) {
    if (event.key !== 'Tab') {
      return
    }
    const panel = panelRef.current
    if (!panel) {
      return
    }
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    if (focusable.length === 0) {
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { panelRef, handleTabTrap }
}
