import type { ParityManifest } from '../manifest'
import { buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'

const manifest: ParityManifest = {
  route: '/', roles: ['tenant_owner'],
  // Welcome makes no requests. The policy belongs to the link destinations.
  endpoints: { 'signup.policy': { method: 'GET', path: '/v1/auth/signups/policy', fixtures: {
    success: { status: 200, body: buildConsoleSignupPolicyFixture() },
  } } },
  fixtures: [], sources: ['src/pages/welcome.tsx', 'src/router.tsx', 'src/App.tsx', 'src/shell/RouteState.tsx'],
  data: [{ name: 'welcome title', locator: { es: 'h1:text-is("Consola In Falcone")', en: 'h1:text-is("In Falcone Console")' } }],
  actions: [], states: [],
}
export default manifest
