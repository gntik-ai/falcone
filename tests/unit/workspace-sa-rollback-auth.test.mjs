import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { createMultiRealmVerifier } from '../../apps/control-plane/jwt-verify.mjs';
import { createJwtVerifier } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createSaRevocationCheck as controlPlaneCheck } from '../../apps/control-plane/sa-revocation.mjs';
import { createSaRevocationCheck as executorCheck } from '../../apps/control-plane-executor/src/runtime/sa-revocation.mjs';
import { startDenialServer } from '../blackbox/helpers/authorization-denial-server.mjs';
import { runBackfill } from '../../scripts/backfill-workspace-service-accounts.mjs';
import { runRollback } from '../../scripts/rollback-workspace-service-accounts.mjs';
import { fixture, W, REALM } from './helpers/workspace-sa-fixture.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'rollback-test', alg: 'RS256' };
const NOW = Date.parse('2030-01-01T00:00:00.900Z');
function token(extra) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: `http://fixture/realms/${REALM}`, sub: 'sa-user',
    azp: 'sa-worker', realm_access: { roles: [] }, iat: 1893456000, exp: 1893456600, ...extra })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`;
}

async function executorRequest(server, path, bearer) {
  const req = Readable.from([]);
  Object.assign(req, { method: 'GET', url: path, headers: { authorization: `Bearer ${bearer}` } });
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } });
  res.writeHead = status => { res.statusCode = status; };
  const finished = new Promise(resolve => res.once('finish', resolve));
  server.emit('request', req, res);
  await finished;
  return { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) };
}

for (const [name, createCheck, createVerifier] of [
  ['control-plane', controlPlaneCheck, createMultiRealmVerifier],
  ['executor', executorCheck, createJwtVerifier],
]) {
  test(`${name} HTTP authentication rejects pre-rollback bound role-less and unbound SA tokens`, async () => {
    const f = fixture();
    f.state.databaseNow = NOW;
    await runBackfill({ ...f.options, argv: ['--apply'] });
    const lookup = async (_pool, clientId, realm) => {
      assert.equal(clientId, 'sa-worker');
      assert.equal(realm, REALM);
      return { status: 'active', credentials_invalidated_at: f.state.cutoff };
    };
    const verifier = createVerifier({
      jwksUrl: 'http://fixture/realms/platform/protocol/openid-connect/certs',
      issuer: 'http://fixture/realms/platform', now: () => NOW,
      fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [key] }) }),
      revocationCheck: createCheck({ pool: f.pool, cacheMs: 0, skewSec: 3,
        realmsBase: 'http://fixture/realms/', platformRealm: 'platform', now: () => NOW,
        store: { getServiceAccountAuthStateByClientId: lookup }, lookupAuthState: lookup }),
    });
    const bound = token({ workspace_id: W });
    const unbound = token({});
    await assert.doesNotReject(verifier.verify(bound, W));
    await assert.doesNotReject(verifier.verify(unbound, 'another-workspace'));
    assert.equal((await runRollback({ ...f.options, argv: ['--apply'], skewSec: 3 })).exitCode, 0);
    if (name === 'executor') {
      const server = createControlPlaneServer({ registry: {}, jwtVerifier: verifier, logger: { error() {} } });
      for (const [bearer, workspace] of [[bound, W], [unbound, 'another-workspace']]) {
        const response = await executorRequest(server, `/v1/workspaces/${workspace}/api-keys`, bearer);
        assert.equal(response.status, 401);
        assert.equal(response.body.code, 'UNAUTHENTICATED');
      }
    } else {
      // API-key listing is executor-only; use the control-plane's authenticated
      // workspace read to exercise its real HTTP authentication/401 boundary.
      const server = await startDenialServer({ verifier });
      for (const [bearer, workspace] of [[bound, W], [unbound, 'another-workspace']]) {
        const response = await server.request(`/v1/workspaces/${workspace}`, { bearer });
        assert.equal(response.status, 401);
        assert.equal(JSON.parse(response.body).code, 'INVALID_TOKEN');
      }
      await server.close();
    }
  });
}
