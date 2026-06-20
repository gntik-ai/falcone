// Shared, env-driven transport-security resolvers (change harden-datastore-transport-tls / #645).
//
// Every application-layer datastore connection (Postgres, the document store over the
// MongoDB wire protocol, and Kafka) routes its TLS/SASL configuration through these pure
// functions so transport encryption can be turned on from the environment alone, identically
// at every call site, with one fail-closed policy.
//
// Design contract (design.md D3/D4):
//   - No TLS env set  => returns "no TLS" (plaintext). The dev/kind default is byte-for-byte
//     unchanged because `with*` helpers only merge config when TLS is actually requested.
//   - Verification requested in production without a readable CA => THROWS (fail closed),
//     mirroring the FLOW_TRIGGER_SECRET_KEY fail-closed idiom (#636). Never silently downgrade.
//
// IMPORTANT: keep this behavior-identical to deploy/kind/control-plane/transport-security.mjs
// (the kind runtime carries a local copy because its image COPYs flat top-level .mjs files).
// tests/blackbox/transport-security.test.mjs asserts the two copies produce identical output.
import { readFileSync } from 'node:fs';

function isTruthy(value) {
  if (value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function isProduction(env) {
  return env.NODE_ENV === 'production';
}

/**
 * Resolve a node-postgres `ssl` option from `PGSSLMODE` (+ `PGSSLROOTCERT`).
 *
 * disable | allow | prefer | unset => false (plaintext)
 * require                          => { rejectUnauthorized: false }   (encrypted, no verification)
 * verify-ca                        => { rejectUnauthorized: true, ca?, checkServerIdentity: skip-hostname }
 * verify-full                      => { rejectUnauthorized: true, ca? }   (chain + hostname)
 *
 * @returns {false | { rejectUnauthorized: boolean, ca?: Buffer, checkServerIdentity?: Function }}
 */
export function resolvePostgresSsl(env = process.env) {
  const mode = String(env.PGSSLMODE ?? '').trim().toLowerCase();
  if (!mode || mode === 'disable' || mode === 'allow' || mode === 'prefer') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  if (mode === 'verify-ca' || mode === 'verify-full') {
    const ssl = { rejectUnauthorized: true };
    const caPath = env.PGSSLROOTCERT;
    if (caPath) {
      try {
        ssl.ca = readFileSync(caPath);
      } catch (err) {
        if (isProduction(env)) {
          throw new Error(`PGSSLMODE=${mode} requires a readable CA at PGSSLROOTCERT (${caPath}): ${err.message}`);
        }
      }
    } else if (isProduction(env)) {
      throw new Error(`PGSSLMODE=${mode} requires PGSSLROOTCERT to be set in production`);
    }
    // verify-ca validates the chain but NOT the hostname; verify-full validates both.
    if (mode === 'verify-ca') ssl.checkServerIdentity = () => undefined;
    return ssl;
  }
  // Unknown mode: stay safe (plaintext) rather than guess.
  return false;
}

/**
 * Merge a resolved Postgres `ssl` option into a pg Pool/Client config, leaving the config
 * untouched when no TLS is requested (so the plaintext default path is unchanged).
 */
export function withPostgresSsl(config = {}, env = process.env) {
  const ssl = resolvePostgresSsl(env);
  return ssl ? { ...config, ssl } : config;
}

/**
 * Resolve MongoClient TLS options from `MONGO_TLS` (+ `MONGO_TLS_CA_FILE`, `MONGO_TLS_INSECURE`).
 * Returns `{}` (no TLS) when MONGO_TLS is not truthy. Fail-closed in production when TLS is
 * requested with verification but no readable CA is provided.
 *
 * @returns {{ tls?: boolean, tlsCAFile?: string, tlsAllowInvalidCertificates?: boolean, tlsAllowInvalidHostnames?: boolean }}
 */
export function resolveMongoTls(env = process.env) {
  if (!isTruthy(env.MONGO_TLS)) return {};
  const opts = { tls: true };
  const insecure = isTruthy(env.MONGO_TLS_INSECURE);
  const caPath = env.MONGO_TLS_CA_FILE;
  if (caPath) {
    try {
      readFileSync(caPath);
      opts.tlsCAFile = caPath;
    } catch (err) {
      if (isProduction(env)) {
        throw new Error(`MONGO_TLS requires a readable CA at MONGO_TLS_CA_FILE (${caPath}): ${err.message}`);
      }
    }
  } else if (isProduction(env) && !insecure) {
    throw new Error('MONGO_TLS requires MONGO_TLS_CA_FILE (or MONGO_TLS_INSECURE) in production');
  }
  if (insecure) {
    opts.tlsAllowInvalidCertificates = true;
    opts.tlsAllowInvalidHostnames = true;
  }
  return opts;
}

/**
 * Merge resolved Mongo TLS options into a MongoClient options object, leaving it untouched
 * when no TLS is requested.
 */
export function withMongoTls(options = {}, env = process.env) {
  const tls = resolveMongoTls(env);
  return Object.keys(tls).length ? { ...options, ...tls } : options;
}

/**
 * Resolve KafkaJS `{ ssl?, sasl? }` from `KAFKA_SSL` (+ `KAFKA_SSL_CA_FILE`,
 * `KAFKA_SSL_REJECT_UNAUTHORIZED`) and `KAFKA_SASL_{MECHANISM,USERNAME,PASSWORD}`.
 * Returns `{}` (no security) when neither is configured. Fail-closed in production when SSL
 * verification is requested with an unreadable CA.
 *
 * @returns {{ ssl?: boolean | object, sasl?: { mechanism: string, username: string, password: string } }}
 */
export function resolveKafkaSecurity(env = process.env) {
  const out = {};
  if (isTruthy(env.KAFKA_SSL)) {
    const caPath = env.KAFKA_SSL_CA_FILE;
    const rejectUnauthorized = env.KAFKA_SSL_REJECT_UNAUTHORIZED == null
      ? true
      : isTruthy(env.KAFKA_SSL_REJECT_UNAUTHORIZED);
    if (caPath) {
      try {
        out.ssl = { ca: [readFileSync(caPath, 'utf8')], rejectUnauthorized };
      } catch (err) {
        if (isProduction(env)) {
          throw new Error(`KAFKA_SSL requires a readable CA at KAFKA_SSL_CA_FILE (${caPath}): ${err.message}`);
        }
        out.ssl = rejectUnauthorized ? true : { rejectUnauthorized };
      }
    } else if (rejectUnauthorized) {
      out.ssl = true;
    } else {
      out.ssl = { rejectUnauthorized: false };
    }
  }
  const mechanism = env.KAFKA_SASL_MECHANISM;
  const username = env.KAFKA_SASL_USERNAME;
  if (mechanism && username) {
    out.sasl = { mechanism, username, password: env.KAFKA_SASL_PASSWORD ?? '' };
  }
  return out;
}
