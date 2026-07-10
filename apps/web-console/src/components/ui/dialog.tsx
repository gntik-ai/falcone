import * as React from 'react'

import { useModalFocusTrap, type UseModalFocusTrapOptions } from '@/components/console/hooks/useModalFocusTrap'
import { cn } from '@/lib/utils'

interface DialogContextValue {
  panelRef: React.RefObject<HTMLDivElement>
  requestClose: () => void
  handleDialogKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

interface DialogContentContextValue {
  titleId: string
  descriptionId: string
  registerTitle: (id: string) => () => void
  registerDescription: (id: string) => () => void
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  closeOnInteractOutside?: boolean
  closeOnEscape?: boolean
  focusTrapOptions?: UseModalFocusTrapOptions
}

const DialogContext = React.createContext<DialogContextValue | null>(null)
const DialogContentContext = React.createContext<DialogContentContextValue | null>(null)

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T) => {
    refs.forEach((ref) => {
      if (!ref) return
      if (typeof ref === 'function') {
        ref(node)
      } else {
        ;(ref as React.MutableRefObject<T>).current = node
      }
    })
  }
}

export function Dialog({
  open,
  onOpenChange,
  children,
  closeOnInteractOutside = false,
  closeOnEscape = true,
  focusTrapOptions
}: DialogProps) {
  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(open, focusTrapOptions)

  const requestClose = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
        return
      }
      handleTabTrap(event)
    },
    [closeOnEscape, handleTabTrap, requestClose]
  )

  const contextValue = React.useMemo<DialogContextValue>(
    () => ({ panelRef, requestClose, handleDialogKeyDown }),
    [handleDialogKeyDown, panelRef, requestClose]
  )

  return open ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (closeOnInteractOutside && event.target === event.currentTarget) {
          requestClose()
        }
      }}
    >
      <DialogContext.Provider value={contextValue}>{children}</DialogContext.Provider>
    </div>
  ) : null
}

export const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (
    {
      className,
      children,
      role = 'dialog',
      tabIndex = -1,
      onClick,
      onKeyDown,
      'aria-modal': ariaModal,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const dialogContext = React.useContext(DialogContext)
    const titleId = React.useId()
    const descriptionId = React.useId()
    const [registeredTitleId, setRegisteredTitleId] = React.useState<string | null>(null)
    const [registeredDescriptionId, setRegisteredDescriptionId] = React.useState<string | null>(null)

    const contentContext = React.useMemo<DialogContentContextValue>(
      () => ({
        titleId,
        descriptionId,
        registerTitle: (id: string) => {
          setRegisteredTitleId(id)
          return () => setRegisteredTitleId((current) => (current === id ? null : current))
        },
        registerDescription: (id: string) => {
          setRegisteredDescriptionId(id)
          return () => setRegisteredDescriptionId((current) => (current === id ? null : current))
        }
      }),
      [descriptionId, titleId]
    )

    const labelledBy = ariaLabelledBy ?? (ariaLabel ? undefined : registeredTitleId ?? undefined)
    const describedBy = ariaDescribedBy ?? registeredDescriptionId ?? undefined

    return (
      <DialogContentContext.Provider value={contentContext}>
        <div
          ref={mergeRefs(dialogContext?.panelRef, ref)}
          role={role}
          aria-modal={ariaModal ?? (role === 'dialog' || role === 'alertdialog' ? true : undefined)}
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={tabIndex}
          className={cn('w-full max-w-3xl rounded-2xl border border-border bg-background p-6 shadow-xl focus:outline-none', className)}
          onClick={(event) => {
            event.stopPropagation()
            onClick?.(event)
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (!event.defaultPrevented) {
              dialogContext?.handleDialogKeyDown(event)
            }
          }}
          {...props}
        >
          {children}
        </div>
      </DialogContentContext.Provider>
    )
  }
)
DialogContent.displayName = 'DialogContent'

export function DialogHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 space-y-1', className)}>{children}</div>
}

export function DialogTitle({ className, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const context = React.useContext(DialogContentContext)
  const titleId = id ?? context?.titleId

  React.useEffect(() => {
    if (!context || !titleId) return
    return context.registerTitle(titleId)
  }, [context, titleId])

  return <h2 id={titleId} className={cn('text-xl font-semibold', className)} {...props} />
}

export function DialogDescription({ className, id, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const context = React.useContext(DialogContentContext)
  const descriptionId = id ?? context?.descriptionId

  React.useEffect(() => {
    if (!context || !descriptionId) return
    return context.registerDescription(descriptionId)
  }, [context, descriptionId])

  return <p id={descriptionId} className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function DialogFooter({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex items-center justify-end gap-2', className)}>{children}</div>
}

export function DialogClose({ children, asChild = false }: { children: React.ReactNode; asChild?: boolean }) {
  const context = React.useContext(DialogContext)

  if (asChild && React.isValidElement<{ onClick?: React.MouseEventHandler }>(children)) {
    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event)
        if (!event.defaultPrevented) {
          context?.requestClose()
        }
      }
    })
  }

  return (
    <button type="button" onClick={() => context?.requestClose()}>
      {children}
    </button>
  )
}
