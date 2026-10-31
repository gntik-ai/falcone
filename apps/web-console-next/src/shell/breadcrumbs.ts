import type { TFunction } from 'i18next'
import type { BreadcrumbItem } from '@gntik-ai/ui'
import { navigation } from './navigation'

function decode(segment: string) {
  try { return decodeURIComponent(segment) } catch { return segment }
}
export function buildBreadcrumbs(pathname: string, t: TFunction): BreadcrumbItem[] {
  const path = pathname.replace(/\/+$/, '') || '/console'
  // Account pages have translated breadcrumbs without shell navigation items.
  const match = [...navigation, { path: '/console/settings', key: 'settings' }, { path: '/console/profile', key: 'profile' }].sort((a, b) => b.path.length - a.path.length).find((item) => path === item.path || path.startsWith(item.path + '/'))
  const base = match?.path ?? '/console'
  const segments = path.slice(base.length).split('/').filter(Boolean)
  const items: BreadcrumbItem[] = [{ label: t('shell.console'), href: path === '/console/overview' ? undefined : '/console/overview' }]
  if (match && match.path !== '/console/overview') items.push({ label: t(`navigation.${match.key}`), href: segments.length ? match.path : undefined })
  if (!segments.length) return items
  const [id, child, executionId] = segments
  const translated = (key: string, value = id) => t(`shell.breadcrumb.${key}`, { id: decode(value) })
  if (base === '/console/flows') {
    items.push({ label: translated('flow'), href: child ? `${base}/${id}` : undefined })
    if (child === 'runs') items.push({ label: translated('runs'), href: executionId ? `${base}/${id}/runs` : undefined })
    if (executionId) items.push({ label: translated('execution', executionId) })
  } else if (base === '/console/mcp/servers') {
    items.push({ label: translated('mcpServer') })
  } else if (base === '/console/workspaces') {
    items.push({ label: translated('workspace'), href: child ? `${base}/${id}` : undefined })
    if (child === 'realtime' || child === 'docs') items.push({ label: translated(child) })
  } else if (base === '/console/operations') items.push({ label: translated('operation') })
  else if (base === '/console/plans') items.push({ label: translated(id === 'new' ? 'newPlan' : 'planId') })
  else if (base === '/console/tenants') {
    items.push({ label: translated('tenant'), href: child ? `${base}/${id}` : undefined })
    if (child === 'plan') items.push({ label: translated('plan') })
  } else {
    items.push(...segments.map((segment, index) => ({
      label: decode(segment).replace(/[-_]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()),
      href: index < segments.length - 1 ? `${base}/${segments.slice(0, index + 1).join('/')}` : undefined,
      mono: true
    })))
  }
  return items
}
