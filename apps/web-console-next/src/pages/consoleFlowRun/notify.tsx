import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import type { ApiError } from '@in-falcone/console-api/http'

export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId' | 'message'>
export function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    requestId: error.requestId ?? error.correlationId ?? '',
    // Only the access-denied state displays backend copy. Network and unknown errors stay localized.
    message: error.status === 403 && typeof error.message === 'string' ? error.message : undefined,
  }
}

// Action failures read as a localized sentence chosen by status; a 403 adds the backend reason.
export function useActionError() {
  const { t } = useTranslation('pages.console-flow-run-page')
  return useCallback((cause: unknown) => {
    const { status, message } = failureFrom(cause)
    const text = t(status && [401, 403, 404, 409, 429].includes(status) ? `errors.${status}` : status && status >= 500 ? 'errors.server' : 'actionFailed')
    return message ? `${text} ${message}` : text
  }, [t])
}

// Results are announced and shown as a toast; failures are assertive.
export function useNotify() {
  const announce = useAnnounce(), toast = useToast()
  const current = useRef({ announce, toast })
  current.current = { announce, toast }
  return useCallback((message: string, error = false) => {
    current.current.announce(message, error ? 'assertive' : 'polite')
    current.current.toast.add({ title: message, tone: error ? 'destructive' : 'success', priority: error ? 'high' : 'low' })
  }, [])
}

export function LocalizedToaster() {
  const { t } = useTranslation('pages.console-flow-run-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // The kit has no prop for the toast viewport's accessible name.
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}
