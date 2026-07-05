import { useEffect } from 'react'

/**
 * Sets `document.title` for as long as the calling component stays mounted, restoring whatever
 * title was in place before it mounted once it unmounts (or once `title` changes again).
 *
 * Used by `AuthLayout` (#731) to give each unauthenticated route (`/`, `/login`, `/signup`,
 * `/signup/pending-activation`, the password-recovery route, and the 404 fallback) its own
 * localized, descriptive `document.title` while the layout is mounted — and to hand the title back
 * to whatever it was (the static `index.html` default, "Consola In Falcone") once the user leaves
 * the unauthenticated funnel, without this mechanism reaching into the authenticated shell.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title

    return () => {
      document.title = previousTitle
    }
  }, [title])
}
