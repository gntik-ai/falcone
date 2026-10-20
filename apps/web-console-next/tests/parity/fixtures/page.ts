import type { ParityManifest } from '../manifest'

// A synthetic page contract, not a migrated application route.
export const pageManifest: Pick<ParityManifest, 'roles' | 'endpoints'> = {
  roles: ['workspace_admin', 'workspace_viewer'],
  endpoints: {
    records: { method: 'GET', path: '/v1/synthetic-records', fixtures: {
      success: (role) => ({ status: 200, body: { label: `Synthetic records for ${role}` } }),
      empty: { status: 200, body: { label: 'No synthetic records' } },
    } },
  },
}
