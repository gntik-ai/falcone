// Shared Tabs primitive (change: add-757-console-dataplane-design-system).
// Accessible tab strip (roving tabindex, aria-selected, ArrowLeft/ArrowRight/Home/End) for the
// mode-switchers that several data-plane screens already hand-roll as button groups (e.g. the
// Postgres schema tab / table-detail tab, the Mongo database/collection tabs, the Storage bucket
// tab). `data-slot` attributes give tests a stable, style-independent hook.
import * as React from 'react'

import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext(component: string): TabsContextValue {
  const ctx = React.useContext(TabsContext)
  if (!ctx) {
    throw new Error(`${component} must be rendered within <Tabs>`)
  }
  return ctx
}

export interface TabsProps extends Omit<React.ComponentProps<'div'>, 'onChange'> {
  value: string
  onValueChange: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(({ value, onValueChange, className, children, ...props }, ref) => (
  <TabsContext.Provider value={{ value, setValue: onValueChange }}>
    <div ref={ref} data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props}>
      {children}
    </div>
  </TabsContext.Provider>
))
Tabs.displayName = 'Tabs'

const TabsList = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, onKeyDown, ...props }, ref) => {
  const localRef = React.useRef<HTMLDivElement | null>(null)

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [ref]
  )

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    const container = localRef.current
    if (!container) return

    const triggers = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'))
    if (triggers.length === 0) return

    const currentIndex = triggers.indexOf(document.activeElement as HTMLButtonElement)

    let nextIndex: number | null = null
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % triggers.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = currentIndex === -1 ? triggers.length - 1 : (currentIndex - 1 + triggers.length) % triggers.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = triggers.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    triggers[nextIndex].focus()
    triggers[nextIndex].click()
  }

  return (
    <div
      ref={setRefs}
      data-slot="tabs-list"
      role="tablist"
      className={cn('flex flex-wrap gap-2', className)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
})
TabsList.displayName = 'TabsList'

export interface TabsTriggerProps extends React.ComponentProps<'button'> {
  value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(({ value, className, children, onClick, ...props }, ref) => {
  const { value: activeValue, setValue } = useTabsContext('TabsTrigger')
  const active = activeValue === value

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      data-slot="tabs-trigger"
      data-state={active ? 'active' : 'inactive'}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        active ? 'bg-primary text-primary-foreground hover:opacity-90' : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          setValue(value)
        }
      }}
      {...props}
    >
      {children}
    </button>
  )
})
TabsTrigger.displayName = 'TabsTrigger'

export interface TabsContentProps extends React.ComponentProps<'div'> {
  value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(({ value, className, children, ...props }, ref) => {
  const { value: activeValue } = useTabsContext('TabsContent')
  if (activeValue !== value) return null

  return (
    <div ref={ref} data-slot="tabs-content" role="tabpanel" className={className} {...props}>
      {children}
    </div>
  )
})
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsList, TabsTrigger, TabsContent }
