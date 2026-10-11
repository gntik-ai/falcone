import test from 'node:test';
import assert from 'node:assert/strict';
import { keycloakPublicBase } from '../../apps/control-plane/keycloak-public-base.mjs';

test('public Keycloak base removes only the issuer realm suffix', () => {
  for (const [issuer, expected] of [
    ['https://iam.example/realms/platform', 'https://iam.example'],
    ['https://iam.example/auth/realms/platform', 'https://iam.example/auth'],
    ['https://iam.example/auth/realms/platform/', 'https://iam.example/auth'],
    ['http://localhost:8080/realms/platform', 'http://localhost:8080'],
  ]) {
    assert.equal(keycloakPublicBase({ KEYCLOAK_ISSUER: issuer }), expected);
  }
});

test('unset or invalid issuers have no public Keycloak base', () => {
  for (const issuer of [undefined, '', 'not-a-url', 'ftp://iam.example/realms/platform',
    'https://user@iam.example/realms/platform', 'https://user:password@iam.example/realms/platform',
    'https://iam.example/auth', 'https://iam.example/realms/',
    'https://iam.example/realms/platform/protocol/openid-connect/token']) {
    assert.equal(keycloakPublicBase({ KEYCLOAK_ISSUER: issuer }), null);
  }
});
