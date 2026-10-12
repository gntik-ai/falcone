import assert from 'node:assert/strict'

export const coreCases = [
  ['core entries load without window or React and retain config and permission helpers', async () => {
    assert.equal(typeof window, 'undefined')
    const api = await import('@in-falcone/console-api')
    for (const entry of ['http', 'session', 'auth', 'config', 'permissions', 'workspace-secrets-access', 'clients', 'loaders', 'fixtures']) {
      await import(`@in-falcone/console-api/${entry}`)
    }
    assert.equal(api.readConsoleShellSession(), null)
    assert.equal(api.consoleAuthConfig.realm, 'in-falcone-platform')
    assert.equal(api.getConsolePermissions(['tenant_viewer']).can('workspace.write'), false)
    assert.equal(api.getConsolePermissions(['tenant_owner']).can('workspace.write'), true)
    assert.equal(api.hasWorkspaceSecretsPrivilegedRole(['tenant_owner']), true)
    assert.equal(api.canManageWorkspaceSecrets(null, 'synthetic-workspace'), false)
  }]
]
