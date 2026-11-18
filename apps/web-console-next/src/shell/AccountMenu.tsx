import { useState, type ReactNode } from 'react'
import { UserMenu, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, type UserMenuEntry, type UserMenuUser } from '@gntik-ai/ui'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { useSession, signOut } from './session'
import { LocaleMenu } from '../i18n/LocaleMenu'

declare const __APP_VERSION__: string
declare const __APP_COMMIT_SHA__: string

export interface AccountMenuModel {
  user: UserMenuUser
  userMenuItems: UserMenuEntry[]
  onSignOut: () => void
  /** The LocaleMenu entries that go inside the menu popup. */
  children: ReactNode
  /** The version dialog opened by the About item; render it once, outside the menu. */
  aboutDialog: ReactNode
}

// Shared by the console sidebar footer (ConsoleShell) and the admin topbar menu.
export function useAccountMenu(mode: 'console' | 'admin' = 'console'): AccountMenuModel {
  const { t } = useTranslation('common')
  const session = useSession()!
  const navigate = useNavigate()
  const [about, setAbout] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const superadmin = (session?.principal?.platformRoles ?? []).includes('superadmin')
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
  const sha = typeof __APP_COMMIT_SHA__ === 'string' ? __APP_COMMIT_SHA__ : ''
  async function logout() {
    if (signingOut) return
    setSigningOut(true)
    try { await signOut(session) } catch { /* Local sign-out still completes after a server failure. */ }
    navigate(consoleAuthConfig.loginPath, { replace: true })
  }
  return {
    user: { name: session.principal?.displayName || session.principal?.username || t('shell.operator'), email: session.principal?.primaryEmail },
    userMenuItems: [
      ...(superadmin ? [{ label: t(mode === 'admin' ? 'shell.backToConsole' : 'shell.adminConsole'), onSelect: () => navigate(mode === 'admin' ? '/console' : '/admin') }] : []),
      { label: t('shell.about'), onSelect: () => setAbout(true) }
    ],
    onSignOut: () => { void logout() },
    children: <LocaleMenu />,
    aboutDialog: <Dialog open={about} onOpenChange={setAbout}><DialogContent closeLabel={t('shell.close')}>
      <DialogHeader><DialogTitle>{t('shell.about')}</DialogTitle></DialogHeader>
      <DialogBody><p>{version}{sha ? ` · ${sha.slice(0, 7)}` : ''}</p></DialogBody>
    </DialogContent></Dialog>
  }
}

export function AccountMenu({ mode = 'console' }: { mode?: 'console' | 'admin' }) {
  const { t } = useTranslation('common')
  const { user, userMenuItems, onSignOut, children, aboutDialog } = useAccountMenu(mode)
  return <>
    <UserMenu user={user} triggerLabel={t('shell.userMenu')} showTheme={false} signOutLabel={t('shell.signOut')} onSignOut={onSignOut} items={userMenuItems}>
      {children}
    </UserMenu>
    {aboutDialog}
  </>
}
