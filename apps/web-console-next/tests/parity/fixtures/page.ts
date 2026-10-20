import type { ParityManifest } from '../manifest'

export default {
  route: '/console/__fixture/page-endpoint',
  roles: ['workspace_admin', 'workspace_viewer'],
  endpoints: { page: { method: 'GET', path: '/v1/synthetic-page', fixtures: { success: { title: 'Synthetic page data' } } } },
} satisfies Pick<ParityManifest, 'route' | 'roles' | 'endpoints'>
