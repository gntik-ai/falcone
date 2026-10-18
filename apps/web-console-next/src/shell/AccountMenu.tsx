import { useState } from 'react'
import { UserMenu, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@gntik-ai/ui'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { useSession, signOut } from './session'
import { LocaleSwitch } from '../i18n/LocaleSwitch'

declare const __APP_VERSION__: string
declare const __APP_COMMIT_SHA__: string
export function AccountMenu() {
  const { t } = useTranslation('common')
  const session = useSession()!
  const navigate = useNavigate()
  const [about, setAbout] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
  const sha = typeof __APP_COMMIT_SHA__ === 'string' ? __APP_COMMIT_SHA__ : ''
  async function logout() {
    if (signingOut) return
    setSigningOut(true)
    try { await signOut(session) } catch { /* Local sign-out still completes after a server failure. */ }
    navigate(consoleAuthConfig.loginPath, { replace: true })
  }
  return <>
    <UserMenu user={{ name: session.principal?.displayName || session.principal?.username || t('shell.operator'), email: session.principal?.primaryEmail }}
      triggerLabel={t('shell.userMenu')} showTheme={false} signOutLabel={t('shell.signOut')} onSignOut={() => { void logout() }}
      items={[{ label: t('shell.about'), onSelect: () => setAbout(true) }]}>
      <div className="p-3"><LocaleSwitch /></div>
    </UserMenu>
    <Dialog open={about} onOpenChange={setAbout}><DialogContent closeLabel={t('shell.close')}>
      <DialogHeader><DialogTitle>{t('shell.about')}</DialogTitle></DialogHeader>
      <DialogBody><p>{version}{sha ? ` · ${sha.slice(0, 7)}` : ''}</p></DialogBody>
    </DialogContent></Dialog>
  </>
}
