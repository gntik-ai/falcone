/**
 * In-memory SeaweedFS/S3 backend fake for reconciler tests. Implements the
 * injected s3Api shape (method-per-operation) with call recording and per-bucket
 * policy-based isolation enforcement so cross-tenant probes can be asserted
 * without a live backend.
 */

function notFound(name) {
  const e = new Error(`NoSuchBucket: ${name}`);
  e.statusCode = 404;
  return e;
}
function accessDenied(name) {
  const e = new Error(`AccessDenied: ${name}`);
  e.statusCode = 403;
  return e;
}

/** Collect the identity name(s) a bucket policy grants, or '*' for wildcard. */
function principalIdentities(policy) {
  const ids = new Set();
  const statements = Array.isArray(policy?.Statement)
    ? policy.Statement
    : [policy?.Statement].filter(Boolean);
  for (const stmt of statements) {
    const p = stmt?.Principal;
    if (p === '*') return '*';
    if (typeof p === 'string') ids.add(p);
    else if (Array.isArray(p)) p.forEach((x) => ids.add(x));
    else if (p && typeof p === 'object' && 'AWS' in p) {
      const aws = Array.isArray(p.AWS) ? p.AWS : [p.AWS];
      if (aws.includes('*')) return '*';
      aws.forEach((x) => ids.add(x));
    }
  }
  return ids;
}

export function createFakeSeaweedFS({ buckets = [] } = {}) {
  /** @type {Map<string, {policy?:object, lifecycle?:object, cors?:object, versioning?:object}>} */
  const state = new Map();
  for (const b of buckets) state.set(b, {});
  const calls = [];
  const ensure = (name) => {
    const m = state.get(name) ?? {};
    state.set(name, m);
    return m;
  };

  const api = {
    async listBuckets() {
      calls.push(['listBuckets']);
      return { Buckets: [...state.keys()].map((Name) => ({ Name })) };
    },
    async headBucket(name, opts = {}) {
      calls.push(['headBucket', name, opts.credential ?? null]);
      if (!state.has(name)) throw notFound(name);
      // Isolation: when a credential is supplied, enforce the bucket policy.
      if (opts.credential) {
        const policy = state.get(name)?.policy;
        if (policy) {
          const ids = principalIdentities(policy);
          if (ids !== '*' && !ids.has(opts.credential.identity)) throw accessDenied(name);
        }
      }
      return {};
    },
    async createBucket(name) {
      calls.push(['createBucket', name]);
      ensure(name);
    },
    async putBucketPolicy(name, policy) {
      calls.push(['putBucketPolicy', name]);
      ensure(name).policy = policy;
    },
    async putBucketLifecycleConfiguration(name, cfg) {
      calls.push(['putBucketLifecycleConfiguration', name]);
      ensure(name).lifecycle = cfg;
    },
    async putBucketCors(name, cfg) {
      calls.push(['putBucketCors', name]);
      ensure(name).cors = cfg;
    },
    async putBucketVersioning(name, cfg) {
      calls.push(['putBucketVersioning', name]);
      ensure(name).versioning = cfg;
    },
  };

  return {
    api,
    calls,
    state,
    countCalls: (op) => calls.filter((c) => c[0] === op).length,
    bucketNames: () => [...state.keys()].sort(),
  };
}
