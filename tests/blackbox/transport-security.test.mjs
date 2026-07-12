// bbx-transport-security
//
// Black-box coverage for change harden-datastore-transport-tls (GitHub #645).
//
// The application had NO code path enabling TLS to any datastore: every pg.Pool/Client,
// MongoClient, and Kafka client was built plaintext. This change adds shared, env-driven,
// pure resolvers so transport encryption can be turned on from the environment alone, with a
// single fail-closed policy, while leaving the plaintext dev/kind default unchanged.
//
// Public surface under test (pure functions of the environment):
//   resolvePostgresSsl / withPostgresSsl  — node-postgres `ssl` from PGSSLMODE (+ PGSSLROOTCERT)
//   resolveMongoTls / withMongoTls        — MongoClient tls options from MONGO_TLS (+ CA)
//   resolveKafkaSecurity                  — KafkaJS { ssl, sasl } from KAFKA_SSL / KAFKA_SASL_*
//
// The kind control-plane carries a behavior-identical local copy; this suite imports BOTH and
// asserts they produce identical output so they cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as shared from '../../packages/internal-contracts/src/transport-security.mjs';
import * as kindLocal from '../../apps/control-plane/transport-security.mjs';

// A real, readable CA file for the verify-* paths (content is irrelevant to the resolver shape).
const TMP = mkdtempSync(join(tmpdir(), 'falcone-tls-'));
const CA_PATH = join(TMP, 'ca.crt');
writeFileSync(CA_PATH, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
const MISSING_CA = join(TMP, 'does-not-exist.crt');
test.after(() => rmSync(TMP, { recursive: true, force: true }));

// Normalize a resolver result so two copies can be compared structurally even though some
// outputs carry functions (checkServerIdentity) or Buffers (ca).
function normalize(value) {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'function') return '[fn]';
    if (Buffer.isBuffer(v)) return `[buf:${v.length}]`;
    return v;
  });
}

// ---- resolvePostgresSsl ----------------------------------------------------

test('bbx-tls-pg-01: unset / disable / allow / prefer => plaintext (false)', () => {
  for (const PGSSLMODE of [undefined, '', 'disable', 'allow', 'prefer', 'DISABLE']) {
    assert.equal(shared.resolvePostgresSsl({ PGSSLMODE }), false, `mode=${PGSSLMODE}`);
  }
});

test('bbx-tls-pg-02: require => encrypted without verification', () => {
  assert.deepEqual(shared.resolvePostgresSsl({ PGSSLMODE: 'require' }), { rejectUnauthorized: false });
  // case-insensitive
  assert.deepEqual(shared.resolvePostgresSsl({ PGSSLMODE: 'REQUIRE' }), { rejectUnauthorized: false });
});

test('bbx-tls-pg-03: verify-full with a CA => verifies chain + hostname, loads CA', () => {
  const ssl = shared.resolvePostgresSsl({ PGSSLMODE: 'verify-full', PGSSLROOTCERT: CA_PATH });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.ok(Buffer.isBuffer(ssl.ca), 'CA buffer is loaded');
  assert.equal(ssl.checkServerIdentity, undefined, 'verify-full keeps default hostname check');
});

test('bbx-tls-pg-04: verify-ca with a CA => verifies chain but skips hostname', () => {
  const ssl = shared.resolvePostgresSsl({ PGSSLMODE: 'verify-ca', PGSSLROOTCERT: CA_PATH });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(typeof ssl.checkServerIdentity, 'function');
  assert.equal(ssl.checkServerIdentity(), undefined, 'hostname check is a no-op for verify-ca');
});

test('bbx-tls-pg-05: production + verify-* + missing/unset CA => FAILS CLOSED (throws)', () => {
  assert.throws(
    () => shared.resolvePostgresSsl({ PGSSLMODE: 'verify-full', NODE_ENV: 'production' }),
    /PGSSLROOTCERT/,
    'unset CA in production throws'
  );
  assert.throws(
    () => shared.resolvePostgresSsl({ PGSSLMODE: 'verify-ca', NODE_ENV: 'production', PGSSLROOTCERT: MISSING_CA }),
    /readable CA/,
    'unreadable CA in production throws'
  );
});

test('bbx-tls-pg-06: non-production + verify-* + missing CA => does NOT throw (eases local TLS)', () => {
  const ssl = shared.resolvePostgresSsl({ PGSSLMODE: 'verify-full' });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.ca, undefined, 'no CA loaded, but no throw outside production');
});

test('bbx-tls-pg-07: require never fails closed even in production without a CA', () => {
  assert.deepEqual(
    shared.resolvePostgresSsl({ PGSSLMODE: 'require', NODE_ENV: 'production' }),
    { rejectUnauthorized: false }
  );
});

test('bbx-tls-pg-08: withPostgresSsl leaves config untouched when no TLS requested', () => {
  const base = { connectionString: 'postgres://x', max: 4 };
  const out = shared.withPostgresSsl(base, { PGSSLMODE: 'disable' });
  assert.deepEqual(out, base, 'plaintext default path is byte-identical');
  assert.equal('ssl' in out, false);
});

test('bbx-tls-pg-09: withPostgresSsl merges ssl when TLS requested', () => {
  const out = shared.withPostgresSsl({ connectionString: 'postgres://x' }, { PGSSLMODE: 'require' });
  assert.deepEqual(out.ssl, { rejectUnauthorized: false });
  assert.equal(out.connectionString, 'postgres://x');
});

// ---- resolveMongoTls -------------------------------------------------------

test('bbx-tls-mongo-01: MONGO_TLS unset/false => no TLS options ({})', () => {
  assert.deepEqual(shared.resolveMongoTls({}), {});
  assert.deepEqual(shared.resolveMongoTls({ MONGO_TLS: 'false' }), {});
});

test('bbx-tls-mongo-02: MONGO_TLS true + CA => tls + tlsCAFile path', () => {
  const out = shared.resolveMongoTls({ MONGO_TLS: '1', MONGO_TLS_CA_FILE: CA_PATH });
  assert.equal(out.tls, true);
  assert.equal(out.tlsCAFile, CA_PATH);
});

test('bbx-tls-mongo-03: production + MONGO_TLS without CA and not insecure => throws', () => {
  assert.throws(
    () => shared.resolveMongoTls({ MONGO_TLS: 'true', NODE_ENV: 'production' }),
    /MONGO_TLS_CA_FILE/
  );
});

test('bbx-tls-mongo-04: MONGO_TLS_INSECURE allows invalid certs/hostnames', () => {
  const out = shared.resolveMongoTls({ MONGO_TLS: 'on', MONGO_TLS_INSECURE: 'yes', NODE_ENV: 'production' });
  assert.equal(out.tls, true);
  assert.equal(out.tlsAllowInvalidCertificates, true);
  assert.equal(out.tlsAllowInvalidHostnames, true);
});

test('bbx-tls-mongo-05: withMongoTls leaves options untouched when no TLS', () => {
  const base = { serverSelectionTimeoutMS: 5000 };
  assert.deepEqual(shared.withMongoTls(base, {}), base);
});

// ---- resolveKafkaSecurity --------------------------------------------------

test('bbx-tls-kafka-01: nothing configured => {} (no ssl, no sasl)', () => {
  assert.deepEqual(shared.resolveKafkaSecurity({}), {});
});

test('bbx-tls-kafka-02: KAFKA_SSL true, no CA => ssl: true (system trust)', () => {
  assert.deepEqual(shared.resolveKafkaSecurity({ KAFKA_SSL: 'true' }), { ssl: true });
});

test('bbx-tls-kafka-03: KAFKA_SSL + CA file => ssl carries the CA', () => {
  const out = shared.resolveKafkaSecurity({ KAFKA_SSL: '1', KAFKA_SSL_CA_FILE: CA_PATH });
  assert.ok(Array.isArray(out.ssl.ca) && out.ssl.ca.length === 1);
  assert.equal(out.ssl.rejectUnauthorized, true);
});

test('bbx-tls-kafka-04: production + KAFKA_SSL + unreadable CA => throws', () => {
  assert.throws(
    () => shared.resolveKafkaSecurity({ KAFKA_SSL: '1', KAFKA_SSL_CA_FILE: MISSING_CA, NODE_ENV: 'production' }),
    /KAFKA_SSL_CA_FILE/
  );
});

test('bbx-tls-kafka-05: SASL from KAFKA_SASL_* (independent of SSL)', () => {
  const out = shared.resolveKafkaSecurity({
    KAFKA_SASL_MECHANISM: 'plain', KAFKA_SASL_USERNAME: 'svc', KAFKA_SASL_PASSWORD: 'pw'
  });
  assert.deepEqual(out, { sasl: { mechanism: 'plain', username: 'svc', password: 'pw' } });
});

test('bbx-tls-kafka-06: SASL username without mechanism is ignored', () => {
  assert.deepEqual(shared.resolveKafkaSecurity({ KAFKA_SASL_USERNAME: 'svc' }), {});
});

// ---- parity: shared vs kind-local copy -------------------------------------

const PARITY_ENVS = [
  {},
  { PGSSLMODE: 'disable' }, { PGSSLMODE: 'require' },
  { PGSSLMODE: 'verify-full', PGSSLROOTCERT: CA_PATH }, { PGSSLMODE: 'verify-ca', PGSSLROOTCERT: CA_PATH },
  { PGSSLMODE: 'verify-full' },
  { PGSSLMODE: 'verify-full', NODE_ENV: 'production', PGSSLROOTCERT: CA_PATH },
  { MONGO_TLS: 'true', MONGO_TLS_CA_FILE: CA_PATH }, { MONGO_TLS: 'on', MONGO_TLS_INSECURE: '1' },
  { KAFKA_SSL: 'true' }, { KAFKA_SSL: '1', KAFKA_SSL_CA_FILE: CA_PATH },
  { KAFKA_SASL_MECHANISM: 'scram-sha-512', KAFKA_SASL_USERNAME: 'u', KAFKA_SASL_PASSWORD: 'p' }
];

test('bbx-tls-parity-01: kind-local copy matches the shared resolvers across an env matrix', () => {
  for (const env of PARITY_ENVS) {
    assert.equal(
      normalize(shared.resolvePostgresSsl(env)), normalize(kindLocal.resolvePostgresSsl(env)),
      `pg ssl parity for ${JSON.stringify(env)}`
    );
    assert.equal(
      normalize(shared.resolveMongoTls(env)), normalize(kindLocal.resolveMongoTls(env)),
      `mongo tls parity for ${JSON.stringify(env)}`
    );
    assert.equal(
      normalize(shared.resolveKafkaSecurity(env)), normalize(kindLocal.resolveKafkaSecurity(env)),
      `kafka security parity for ${JSON.stringify(env)}`
    );
  }
});

test('bbx-tls-parity-02: fail-closed behavior is identical across copies', () => {
  const prodNoCa = { PGSSLMODE: 'verify-full', NODE_ENV: 'production' };
  assert.throws(() => shared.resolvePostgresSsl(prodNoCa));
  assert.throws(() => kindLocal.resolvePostgresSsl(prodNoCa));
});
