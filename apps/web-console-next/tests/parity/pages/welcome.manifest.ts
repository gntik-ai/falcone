import type { ParityManifest } from '../manifest'

const manifest: ParityManifest = {
  route: '/', roles: ['tenant_owner'],
  // Welcome makes no requests. Login's policy read uses the shared shell fixture.
  endpoints: {},
  fixtures: [], sources: ['src/pages/welcome.tsx', 'src/router.tsx', 'src/App.tsx', 'src/shell/RouteState.tsx'],
  data: [{ name: 'welcome title', locator: { es: 'h1:text-is("Consola In Falcone")', en: 'h1:text-is("In Falcone Console")' } }],
  actions: [], states: [],
}
export default manifest
