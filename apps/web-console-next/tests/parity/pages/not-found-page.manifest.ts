import type { ParityManifest } from '../manifest'

const manifest: ParityManifest = {
  route: '/does-not-exist', roles: ['tenant_owner'],
  endpoints: {}, fixtures: [],
  sources: ['src/pages/notFound.tsx', 'src/router.tsx'],
  data: [{ name: 'not-found heading', locator: {
    es: 'h1:text-is("Página no encontrada")', en: 'h1:text-is("Page not found")',
  } }],
  // Recovery actions and chunk states have no API endpoint. The companion spec
  // checks navigation and script interception directly, including zero requests.
  actions: [], states: [],
}
export default manifest
