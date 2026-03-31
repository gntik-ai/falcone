export function seedTenantUsageFixture(overrides = {}) {
  return {
    max_workspaces: { observedUsage: 8, usageSource: 'fixture' },
    max_api_keys: { observedUsage: 2, usageSource: 'fixture' },
    ...overrides
  };
}
