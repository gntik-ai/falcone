/**
 * IAM domain seed for restore E2E tests.
 * Seeds roles, groups, and client scopes via product API.
 * @module tests/e2e/fixtures/restore/seed-iam
 */

/**
 * @param {string} tenantId
 * @param {string} executionId
 * @param {'minimal'|'standard'|'conflicting'} level
 * @param {import('../../helpers/api-client.mjs').ApiClient} [client]
 * @param {Object} [overrides] - DI overrides for testing without real API
 * @returns {Promise<{ roles: string[], groups: string[], clientScopes: string[] }>}
 */
export async function seedIam(tenantId, executionId, level = 'standard', client = null, overrides = {}) {
  const roleCounts = { minimal: 1, standard: 3, conflicting: 3 };
  const count = roleCounts[level] ?? 3;

  const roles = [];
  const groups = [];
  const clientScopes = [];

  for (let i = 1; i <= count; i++) {
    const roleName = `restore-role-${executionId}-${i}`;
    const composites = level === 'conflicting' && i === 1
      ? { realm: [`restore-composite-alt-${executionId}`] }
      : { realm: [] };

    roles.push(roleName);

    if (overrides.createRole) {
      await overrides.createRole(tenantId, { name: roleName, composites, attributes: {} });
    }
  }

  if (level !== 'minimal') {
    const groupName = `restore-group-${executionId}-1`;
    groups.push(groupName);
    if (overrides.createGroup) {
      await overrides.createGroup(tenantId, { name: groupName });
    }

    const scopeName = `restore-scope-${executionId}-1`;
    clientScopes.push(scopeName);
    if (overrides.createClientScope) {
      await overrides.createClientScope(tenantId, { name: scopeName, protocol: 'openid-connect' });
    }
  }

  return { roles, groups, clientScopes };
}
