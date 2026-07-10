import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

// Shared focus behavior for the console dialog primitive and the few remaining hand-rolled modals,
// so Tab-trap + focus-return semantics live in one place instead of being reimplemented per dialog.
export const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface UseModalFocusTrapOptions {
  // 'first' (default) moves focus to the first focusable descendant of the panel on open (or the
  // panel itself if there is none). 'panel' always focuses the panel container itself, regardless
  // of its focusable descendants — used where the panel is the accessible-name-bearing element and
  // callers rely on it (not a specific child) receiving focus on open.
  initialFocus?: 'first' | 'panel'
  // Resolves the element focus should return to when the modal closes, evaluated LAZILY AT CLOSE
  // TIME (not captured once when the modal opened). Use this when the original trigger may be
  // unmounted/remounted while the modal is open — e.g. a background list reload triggered by the
  // action that opened the modal (issuing/rotating a credential) can unmount-then-remount the
  // triggering row as a brand-new DOM node. A node reference captured at open time would then be
  // detached by close time, and calling `.focus()` on a detached node is a silent no-op (#783).
  // Return `null`/`undefined` (or omit this option) to fall back to the node that had focus when
  // the modal opened, as before.
  resolveReturnFocus?: () => HTMLElement | null | undefined
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
  // Kept current on every render (not just when `open` changes) so the close-time cleanup below
  // always calls the LATEST `resolveReturnFocus` closure — which itself reads whatever live
  // identifying state (e.g. a ref set at open time) it needs at the moment it is invoked, not at
  // the moment this ref was last written.
  const resolveReturnFocusRef = useRef<UseModalFocusTrapOptions['resolveReturnFocus']>(options.resolveReturnFocus)
  resolveReturnFocusRef.current = options.resolveReturnFocus

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
      const dynamicTarget = resolveReturnFocusRef.current?.()
      const target = dynamicTarget ?? restoreFocusRef.current
      target?.focus?.()
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
