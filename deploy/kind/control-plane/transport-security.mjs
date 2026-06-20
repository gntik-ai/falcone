// Local copy of the shared transport-security resolvers (change harden-datastore-transport-tls
// / #645). The kind control-plane is a self-contained runtime whose Dockerfile COPYs flat
// top-level .mjs files, so it cannot cleanly resolve @in-falcone/internal-contracts; this copy
// keeps it self-contained. It MUST stay behavior-identical to
// services/internal-contracts/src/transport-security.mjs —
// tests/blackbox/transport-security.test.mjs imports both and asserts identical output.
import { readFileSync } from 'node:fs';

function isTruthy(value) {
  if (value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function isProduction(env) {
  return env.NODE_ENV === 'production';
}

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
    if (mode === 'verify-ca') ssl.checkServerIdentity = () => undefined;
    return ssl;
  }
  return false;
}

export function withPostgresSsl(config = {}, env = process.env) {
  const ssl = resolvePostgresSsl(env);
  return ssl ? { ...config, ssl } : config;
}

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

export function withMongoTls(options = {}, env = process.env) {
  const tls = resolveMongoTls(env);
  return Object.keys(tls).length ? { ...options, ...tls } : options;
}

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
