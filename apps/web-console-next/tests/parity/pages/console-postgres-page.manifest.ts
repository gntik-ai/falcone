import type { ParityManifest } from '../manifest'
import * as pg from '../fixtures/postgres'

export { pg }
const manifest: ParityManifest = {
  route: '/console/postgres', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'],
  fixtures: ['pg-databases', 'pg-schemas', 'pg-tables', 'pg-views', 'pg-matviews', 'pg-table-detail', 'pg-cursor-set', 'pg-delayed-set', 'pg-retry-set', 'pg-no-query-set', 'pg-ddl-preview', 'metrics-quotas-available', 'metrics-quotas-exhausted', 'workspace-database-create-ok'],
  sources: ['src/pages/consolePostgres.tsx', 'src/pages/consolePostgres'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Inventario relacional de la organización activa")', en: 'h1:text-is("Relational inventory of the active organization")' } }],
  actions: [], states: [],
}
export default manifest
