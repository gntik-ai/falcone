/**
 * Capability catalogue with known gated routes for testing.
 *
 * Each capability maps to at least two routes (method + path) that are
 * protected by the capability gate in the APISIX gateway.
 *
 * Path patterns use `{workspaceId}` as a placeholder that must be replaced
 * at runtime with a real workspace ID.
 */

/**
 * @typedef {{ method: string, path: string }} GatedRoute
 * @typedef {{ capability: string, routes: GatedRoute[] }} CapabilityEntry
 */

/** @type {CapabilityEntry[]} */
export const CAPABILITY_CATALOGUE = [
  {
    capability: 'webhooks',
    routes: [
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/webhooks' },
      { method: 'POST', path: '/v1/workspaces/{workspaceId}/webhooks' },
    ],
  },
  {
    capability: 'realtime',
    routes: [
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/realtime' },
      { method: 'GET', path: '/v1/events/subscribe' },
    ],
  },
  {
    capability: 'sql_admin_api',
    routes: [
      { method: 'POST', path: '/v1/workspaces/{workspaceId}/admin/sql' },
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/sql' },
    ],
  },
  {
    capability: 'passthrough_admin',
    routes: [
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/admin/passthrough' },
      { method: 'POST', path: '/v1/workspaces/{workspaceId}/admin/passthrough' },
    ],
  },
  {
    capability: 'public_functions',
    routes: [
      { method: 'POST', path: '/v1/functions/{functionId}/invoke' },
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/functions/public' },
    ],
  },
  {
    capability: 'custom_domains',
    routes: [
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/domains' },
      { method: 'POST', path: '/v1/workspaces/{workspaceId}/domains' },
    ],
  },
  {
    capability: 'scheduled_functions',
    routes: [
      { method: 'GET', path: '/v1/workspaces/{workspaceId}/functions/scheduled' },
      { method: 'POST', path: '/v1/workspaces/{workspaceId}/functions/scheduled' },
    ],
  },
];

/** Map from capability key to its catalogue entry. */
export const CAPABILITY_MAP = new Map(
  CAPABILITY_CATALOGUE.map((entry) => [entry.capability, entry]),
);

/** All capability keys. */
export const ALL_CAPABILITIES = CAPABILITY_CATALOGUE.map((e) => e.capability);
