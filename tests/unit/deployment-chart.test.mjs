import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDeploymentChartViolations,
  collectUpgradeValidationViolations,
  compareVersions,
  readProfileValues,
  readRootChart,
  readRootValues,
  readWrapperChart,
  REQUIRED_COMPONENT_ALIASES,
  RECOMMENDED_DEPLOYMENT_PROFILES,
  resolveComponentImage,
  resolveImageRepository
} from '../../scripts/lib/deployment-chart.mjs';
import { readDeploymentTopology } from '../../scripts/lib/deployment-topology.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';

test('deployment chart stays internally consistent with packaging guidance', () => {
  const violations = collectDeploymentChartViolations(
    readRootChart(),
    readRootValues(),
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.deepEqual(violations, []);
});

test('deployment validation accepts supported Temporal UI exposure configurations', () => {
  for (const [enabled, disableWriteActions, networkPolicyEnabled] of [
    [true, true, true],
    [false, true, true],
    [true, false, true],
    [true, true, false],
    [false, false, false]
  ]) {
    const values = structuredClone(readRootValues());
    values.temporal.ui.enabled = enabled;
    values.temporal.ui.disableWriteActions = disableWriteActions;
    values.temporal.networkPolicy.enabled = networkPolicyEnabled;

    assert.deepEqual(collectDeploymentChartViolations(
      readRootChart(), values, readDeploymentTopology(), readWrapperChart(), readDomainModel()
    ), []);
  }
});

test('deployment validation rejects malformed Temporal UI blocks and non-boolean exposure settings', () => {
  for (const ui of [undefined, null, 'yes', false, []]) {
    const values = structuredClone(readRootValues());
    values.temporal.ui = ui;
    const violations = collectDeploymentChartViolations(
      readRootChart(), values, readDeploymentTopology(), readWrapperChart(), readDomainModel()
    );
    assert.ok(violations.includes('temporal.ui must be an object with boolean enabled and disableWriteActions settings.'));
  }

  for (const [block, key] of [['ui', 'enabled'], ['ui', 'disableWriteActions'], ['networkPolicy', 'enabled']]) {
    for (const invalid of [undefined, null, 'yes', 'false', 0, 1, {}, []]) {
      const values = structuredClone(readRootValues());
      values.temporal[block][key] = invalid;
      const violations = collectDeploymentChartViolations(
        readRootChart(), values, readDeploymentTopology(), readWrapperChart(), readDomainModel()
      );
      assert.ok(violations.includes(`temporal.${block}.${key} must be a boolean (true or false).`));
    }
  }
});

test('deployment validation rejects write-enabled Temporal UI without NetworkPolicy protection', () => {
  const values = structuredClone(readRootValues());
  values.temporal.ui.enabled = true;
  values.temporal.ui.disableWriteActions = false;
  values.temporal.networkPolicy.enabled = false;

  const violations = collectDeploymentChartViolations(
    readRootChart(), values, readDeploymentTopology(), readWrapperChart(), readDomainModel()
  );
  assert.ok(violations.includes('Temporal UI write actions require the UI to be NetworkPolicy-restricted: set temporal.networkPolicy.enabled=true or temporal.ui.disableWriteActions=true.'));
});

test('deployment validation rejects a custom tenant audience until all provisioners and kind routes are wired', () => {
  const values = structuredClone(readRootValues());
  values.gateway.mongoBearer.tenantAudience = 'custom-data-api';
  const violations = collectDeploymentChartViolations(
    readRootChart(), values, readDeploymentTopology(), readWrapperChart(), readDomainModel()
  );
  assert.ok(violations.some((violation) => violation.includes('tenantAudience must remain falcone-data-api')));
});

test('deployment validation rejects legacy Keycloak route matches and rewrite targets', () => {
  const values = structuredClone(readRootValues());
  const routes = values.bootstrap.reconcile.apisix.routes;
  const identity = routes.find((route) => route.name === 'identity');
  const admin = routes.find((route) => route.name === 'native-keycloak-admin');
  identity.uri = '/realms/*';
  admin.plugins['proxy-rewrite'].regex_uri[1] = '/admin/$1';

  const violations = () => collectDeploymentChartViolations(
    readRootChart(), values, readDeploymentTopology(), readWrapperChart(), readDomainModel()
  );
  const legacyViolations = () => violations().filter((violation) => violation.includes('legacy Keycloak /auth prefix'));
  assert.deepEqual(legacyViolations(), []);
  assert.ok(!violations().some((violation) => violation.includes('route identity must use uri')));

  identity.uri = '/auth/*';
  assert.equal(legacyViolations().length, 1);
  assert.ok(violations().includes('bootstrap APISIX route identity must use uri /realms/*.'));
  identity.uri = '/realms/*';

  identity.uris = ['/realms/*', '/auth/realms/*'];
  assert.equal(legacyViolations().length, 1);
  delete identity.uris;

  admin.plugins['proxy-rewrite'].regex_uri[1] = '/auth/admin/$1';
  assert.equal(legacyViolations().length, 1);
  admin.plugins['proxy-rewrite'].regex_uri[1] = '/admin/$1';

  admin.plugins['proxy-rewrite'].uri = '/auth/admin';
  assert.equal(legacyViolations().length, 1);
});

test('deployment chart validation detects missing dependency aliases and values layers', () => {
  const brokenChart = structuredClone(readRootChart());
  brokenChart.dependencies = brokenChart.dependencies.filter((entry) => entry.alias !== 'ferretdb');

  const brokenValues = structuredClone(readRootValues());
  delete brokenValues.deployment.valuesLayers.airgap;

  const violations = collectDeploymentChartViolations(
    brokenChart,
    brokenValues,
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.ok(violations.some((violation) => violation.includes('Missing wrapper dependency alias ferretdb')));
  assert.ok(violations.some((violation) => violation.includes('deployment.valuesLayers must include airgap')));
});

test('deployment chart validation detects bootstrap catalog drift and invalid secret strategies', () => {
  const brokenValues = structuredClone(readRootValues());
  brokenValues.bootstrap.secretResolution.supportedStrategies = ['kubernetesSecret', 'env'];
  brokenValues.bootstrap.oneShot.governanceCatalog.plans = brokenValues.bootstrap.oneShot.governanceCatalog.plans.slice(1);

  const violations = collectDeploymentChartViolations(
    readRootChart(),
    brokenValues,
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.ok(violations.some((violation) => violation.includes('bootstrap.secretResolution.supportedStrategies')));
  assert.ok(violations.some((violation) => violation.includes('governanceCatalog.plans')));
});


test('deployment chart keeps the Keycloak platform and tenant IAM bootstrap baseline', () => {
  const values = readRootValues();
  const keycloakBootstrap = values.bootstrap.oneShot.keycloak;

  assert.ok(keycloakBootstrap.realmRoles.includes('platform_admin'));
  assert.ok(keycloakBootstrap.realmRoles.includes('tenant_owner'));
  assert.ok(keycloakBootstrap.realmRoles.includes('tenant_developer'));
  assert.ok(keycloakBootstrap.realmRoles.includes('tenant_viewer'));
  assert.ok(keycloakBootstrap.realmRoles.includes('workspace_owner'));
  assert.ok(keycloakBootstrap.realmRoles.includes('workspace_admin'));
  assert.ok(keycloakBootstrap.realmRoles.includes('workspace_service_account'));
  assert.ok(keycloakBootstrap.clientScopes.some((scope) => scope.name === 'tenant-context'));
  assert.ok(keycloakBootstrap.clientScopes.some((scope) => scope.name === 'workspace-context'));
  assert.ok(keycloakBootstrap.clients.some((client) => client.clientId === 'in-falcone-gateway'));
  assert.ok(keycloakBootstrap.clients.some((client) => client.clientId === 'in-falcone-console'));
  assert.equal(keycloakBootstrap.realm.login.registrationAllowed, true);
  assert.equal(keycloakBootstrap.realm.login.resetPasswordAllowed, true);
  assert.equal(keycloakBootstrap.clients.find((client) => client.clientId === 'in-falcone-console').directAccessGrantsEnabled, true);
  assert.equal(keycloakBootstrap.tenantRealmTemplate.realmIdPattern, 'tenant-{tenantSlug}');
  assert.equal(
    keycloakBootstrap.tenantRealmTemplate.serviceAccountTemplate.credentialRefPattern,
    'secret://iam/{tenantId}/{workspaceId}/service-accounts/{serviceAccountId}'
  );

  assert.equal(values.webConsole.auth.loginPath, '/login');
  assert.equal(values.webConsole.auth.signupPath, '/signup');
  assert.equal(values.webConsole.auth.autoSignupPolicy.globalMode, 'approval_required');
  assert.equal(values.webConsole.auth.autoSignupPolicy.environmentModes.dev, 'auto_activate');
  assert.equal(values.webConsole.auth.autoSignupPolicy.planModes.enterprise, 'auto_activate');
  assert.equal(values.webConsole.auth.expirationPolicies.invitations.defaultTtl, '72h');
  assert.equal(values.webConsole.auth.expirationPolicies.humanCredentials.passwordMaxAge, '90d');
  assert.equal(values.webConsole.auth.expirationPolicies.serviceCredentials.rotateBefore, '7d');
  assert.equal(values.webConsole.auth.expirationPolicies.sessions.idleTimeout, '30m');
});

test('all expected component aliases are present in the root chart dependencies', () => {
  const aliases = readRootChart()
    .dependencies.filter((entry) => entry.name === 'component-wrapper')
    .map((entry) => entry.alias);
  assert.deepEqual(aliases, REQUIRED_COMPONENT_ALIASES);
});

test('recommended deployment profile overlays exist and declare their own profile id', () => {
  const declaredProfiles = RECOMMENDED_DEPLOYMENT_PROFILES.map((profileId) => readProfileValues(profileId).deployment.profile);
  assert.deepEqual(declaredProfiles, RECOMMENDED_DEPLOYMENT_PROFILES);
});

test('registry rewriting preserves repository paths while swapping the registry host', () => {
  assert.equal(resolveImageRepository('docker.io/apache/apisix', 'registry.airgap.in-falcone.local'), 'registry.airgap.in-falcone.local/apache/apisix');
  assert.equal(
    resolveImageRepository('ghcr.io/example/in-falcone-control-plane', 'registry.airgap.in-falcone.local'),
    'registry.airgap.in-falcone.local/example/in-falcone-control-plane'
  );

  const values = readRootValues();
  const mirroredValues = structuredClone(values);
  mirroredValues.global.imageRegistry = 'registry.airgap.in-falcone.local';
  assert.equal(resolveComponentImage(mirroredValues, 'apisix'), 'registry.airgap.in-falcone.local/apache/apisix:3.10.0-debian');
});

test('upgrade validation requires an approved currentVersion during in-place upgrades', () => {
  const chart = readRootChart();
  const values = readRootValues();

  assert.deepEqual(
    collectUpgradeValidationViolations(chart, values, { releaseIsUpgrade: true, currentVersion: '0.2.0' }),
    []
  );

  const missingVersionViolations = collectUpgradeValidationViolations(chart, values, {
    releaseIsUpgrade: true,
    currentVersion: ''
  });
  assert.ok(missingVersionViolations.some((violation) => violation.includes('currentVersion is required')));

  const unsupportedVersionViolations = collectUpgradeValidationViolations(chart, values, {
    releaseIsUpgrade: true,
    currentVersion: '0.1.0'
  });
  assert.ok(unsupportedVersionViolations.some((violation) => violation.includes('not listed in supportedPreviousVersions')));
});

test('compareVersions orders supported chart upgrades predictably', () => {
  assert.equal(compareVersions('0.2.0', '0.3.0') < 0, true);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.4.0', '0.3.0') > 0, true);
});
