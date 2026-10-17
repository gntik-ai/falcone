import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';

const readContract = path => JSON.parse(readFileSync(
  new URL(`../../apps/control-plane-executor/openapi/${path}`, import.meta.url),
));
const document = readContract('control-plane.openapi.json');

function validator(schema) {
  return new Ajv({ strict: false, validateFormats: false }).compile({
    ...schema,
    components: document.components,
  });
}

test('published request and response schemas accept runtime UUID identifiers', async t => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const timestamps = {
    createdAt: '2026-10-17T00:00:00Z',
    updatedAt: '2026-10-17T00:00:00Z',
  };
  const instances = {
    AccessCheckRequest: {
      tenantId,
      workspaceId,
      resourceType: 'workspace',
      resourceId: workspaceId,
      action: 'workspace.update',
    },
    Workspace: {
      entityType: 'workspace',
      tenantId,
      workspaceId,
      slug: 'uuid-contract',
      displayName: 'UUID contract workspace',
      environment: 'dev',
      state: 'active',
      timestamps,
      metadata: {},
      iamBoundary: {
        realm: 'contract',
        clientNamespace: 'contract',
        defaultClientScopes: [],
        keyPolicy: {
          secretBackend: 'keycloak',
          secretPathPrefix: 'workspaces/contract',
          referenceMode: 'reference_only',
          defaultRotationDays: 30,
          maxActiveKeys: 2,
        },
      },
      resourceInheritance: { mode: 'tenant_defaults', logicalResources: [] },
      apiSurface: {
        workspaceId,
        workspaceSlug: 'uuid-contract',
        environment: 'dev',
        controlApiBaseUrl: 'https://api.example.test',
        consoleBaseUrl: 'https://console.example.test',
        identityBaseUrl: 'https://identity.example.test',
        realtimeBaseUrl: 'https://realtime.example.test',
        applicationBaseUrlPattern: 'https://{app}.example.test',
        endpoints: [],
        applicationEndpoints: [],
      },
    },
    WorkspaceMembership: {
      entityType: 'workspace_membership',
      workspaceMembershipId: 'wmb_contract',
      tenantId,
      workspaceId,
      userId: randomUUID(),
      grantedByUserId: randomUUID(),
      role: 'workspace_developer',
      membershipStatus: 'active',
      state: 'active',
      timestamps,
      metadata: {},
    },
  };

  for (const [name, instance] of Object.entries(instances)) {
    await t.test(name, () => {
      const validate = validator(document.components.schemas[name]);
      assert.ok(validate(instance), JSON.stringify(validate.errors));
    });
  }
});

test('tenant, workspace and user parameter schemas accept UUID identifiers', async t => {
  for (const name of ['TenantId', 'WorkspaceId', 'UserId', 'FilterTenantId']) {
    await t.test(name, () => {
      const validate = validator(document.components.parameters[name].schema);
      assert.ok(validate(randomUUID()), JSON.stringify(validate.errors));
    });
  }
});

test('maintained contracts contain no tenant, workspace or user prefix patterns', async t => {
  function findPatterns(value, path = '#', matches = []) {
    if (!value || typeof value !== 'object') return matches;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${key}`;
      if (key === 'pattern' && typeof child === 'string' && /^\^(ten|wrk|usr)_/.test(child)) {
        matches.push(childPath);
      }
      findPatterns(child, childPath, matches);
    }
    return matches;
  }

  for (const path of ['control-plane.openapi.json', 'families/functions.openapi.json', 'families/storage.openapi.json']) {
    await t.test(path, () => {
      assert.deepEqual(findPatterns(readContract(path)), []);
    });
  }
});

test('invitation identifiers retain their prefix constraint and reject bare UUIDs', () => {
  const schema = document.components.parameters.InvitationId.schema;
  assert.equal(schema.pattern, '^inv_[0-9a-z]+$');
  const validate = validator(schema);
  assert.ok(validate('inv_contract'), JSON.stringify(validate.errors));
  assert.equal(validate(randomUUID()), false);
  assert.equal(validate.errors[0].keyword, 'pattern');
});
