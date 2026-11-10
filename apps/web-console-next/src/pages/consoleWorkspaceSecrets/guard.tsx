import type { ReactNode } from 'react'
import { Guard } from '../../shell/guards'
import { useCopy } from './copy'

// The denial heading comes from this page's catalog so it follows the active locale, without loading the page.
export function SecretsGuard({ children }: { children: ReactNode }) {
  const { t } = useCopy()
  return <Guard kind="secrets" denialTitle={t('guardDenied')}>{children}</Guard>
}
