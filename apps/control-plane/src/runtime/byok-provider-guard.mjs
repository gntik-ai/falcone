// BYOK provider guard (change: fix-byok-secretref-endpoint-confinement / #659).
//
// A single, fail-closed chokepoint that confines a BYOK (bring-your-own-key) provider
// configuration — used by BOTH the LLM completion plane (llm-executor.mjs) and the embedding
// plane (embedding-executor.mjs), in the control-plane executor AND the workflow worker.
//
// The vulnerability this closes (#659): the provider config persisted a caller-supplied
// `secretRef.name` and `endpoint` VERBATIM, and the secret resolver did
// `process.env[secretRef.name]` for ANY name. A tenant_owner could therefore name ANY env var
// the executor pod holds (HOSTNAME, GATEWAY_SHARED_SECRET, PGPASSWORD, MONGO_PASSWORD,
// FERRETDB_TENANT_URI__*, …) and have it POSTed as `Authorization: Bearer <value>` to an
// arbitrary endpoint — including cloud-metadata / loopback / private targets (SSRF).
//
// Two defenses, both fail-closed:
//   1. SECRET CONFINEMENT — the BYOK key is resolvable ONLY from a secret whose env-var name
//      matches an operator-controlled reserved prefix allow-list (default `BYOK_`). A
//      non-allow-listed name is NEVER read from process.env (so an existing malicious row
//      resolves to null and the call fails closed), and is rejected at config time (400).
//   2. ENDPOINT SSRF GUARD — the provider endpoint is validated against the shared blocklist
//      (RFC1918, loopback, link-local 169.254/fe80, ULA, IPv4-mapped, NAT64, CGNAT, metadata —
//      reused from services/webhook-engine via isBlockedIp), with numeric-IPv4 normalization
//      and DNS resolution of the host (rebinding defense). Rejected at config time AND
//      re-validated just before the outbound fetch.
import dns from 'node:dns';
import net from 'node:net';
import { isBlockedIp } from '../../../../services/webhook-engine/src/webhook-subscription.mjs';
import { clientError } from './errors.mjs';

// Reserved env-var prefix that an operator-provisioned BYOK secret MUST carry. Keeping the key
// behind a dedicated prefix means a caller can never name an unrelated platform secret
// (PGPASSWORD, GATEWAY_SHARED_SECRET, …) because those do NOT start with it.
export const DEFAULT_SECRET_PREFIX = 'BYOK_';

// A valid POSIX env-var identifier. We reject anything that is not a plain identifier so a
// caller cannot smuggle expansion/quirky characters into the name we look up.
const ENV_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse the operator-controlled reserved-prefix allow-list from `BYOK_SECRET_ALLOWED_PREFIXES`
 * (comma-separated). Empty entries are filtered out and, when the result is empty, falls back to
 * the DEFAULT `['BYOK_']`.
 *
 * CRITICAL: an empty-string prefix is NEVER kept — `''.startsWith('')` (and thus
 * `name.startsWith('')`) is true for every string, which would reintroduce the vulnerability by
 * allow-listing ALL env vars. The empty-filter + non-empty fallback guarantees at least one
 * real prefix is always in force.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {string[]} a non-empty list of reserved prefixes
 */
export function parseAllowedSecretPrefixes(env = process.env) {
  const raw = env?.BYOK_SECRET_ALLOWED_PREFIXES;
  const parsed = String(raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0); // NEVER keep '' — it would match every env var.
  return parsed.length > 0 ? parsed : [DEFAULT_SECRET_PREFIX];
}

/**
 * Operator-controlled endpoint host suffix allow-list from `BYOK_ENDPOINT_ALLOWED_HOSTS`
 * (comma-separated). When non-empty, an endpoint host MUST match one suffix (in addition to
 * passing the SSRF blocklist). When empty/unset, only the blocklist applies.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {string[]}
 */
export function parseAllowedEndpointHosts(env = process.env) {
  return String(env?.BYOK_ENDPOINT_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

/**
 * True iff `name` is a non-empty valid env identifier that starts with one of `prefixes`.
 * Pure + synchronous so it can gate BOTH the config-time check and the per-request resolve.
 *
 * @param {unknown} name
 * @param {string[]} prefixes
 * @returns {boolean}
 */
export function isAllowedSecretName(name, prefixes = [DEFAULT_SECRET_PREFIX]) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (!ENV_IDENTIFIER.test(name)) return false;
  // Defensive: ignore any empty prefix that slipped through (parse already filters them).
  return prefixes.some((p) => typeof p === 'string' && p.length > 0 && name.startsWith(p));
}

/**
 * Config-time assertion for a provider `secretRef`. A secretRef that carries a `name` (the
 * env-var lookup form the deployed resolver uses) MUST name an allow-listed secret. A secretRef
 * with no `name` (e.g. a `{ vaultPath }` form) is NOT an env-var attack vector and is left to
 * the resolver's own fail-closed handling, so it is not rejected here.
 *
 * @param {{ name?: string }|undefined} secretRef
 * @param {string[]} prefixes
 * @throws {Error} clientError 400 BYOK_SECRET_REF_NOT_ALLOWED
 */
export function assertSecretRefAllowed(secretRef, prefixes = [DEFAULT_SECRET_PREFIX]) {
  // Only the env-var (`name`) form is governed here; a name-less ref cannot resolve an env var.
  if (secretRef?.name === undefined) return;
  if (!isAllowedSecretName(secretRef.name, prefixes)) {
    throw clientError(
      `BYOK provider secretRef name is not in the allowed prefix allow-list (expected one of: ${prefixes.join(', ')})`,
      400,
      'BYOK_SECRET_REF_NOT_ALLOWED',
    );
  }
}

/**
 * Build a confined secret resolver: the DEFAULT resolver for both executors. It resolves the
 * env var named by `secretRef.name` ONLY when that name is allow-listed; otherwise it returns
 * null WITHOUT reading process.env (fail-closed). This makes any pre-existing malicious row —
 * persisted before this guard shipped — resolve to null at request time, so no completion ever
 * leaks an arbitrary env var.
 *
 * @param {{ env?: Record<string,string|undefined>, prefixes?: string[] }} [options]
 * @returns {(secretRef: {name?: string}|undefined) => Promise<string|null>}
 */
export function createConfinedSecretResolver({ env = process.env, prefixes } = {}) {
  const allowed = prefixes ?? parseAllowedSecretPrefixes(env);
  return async (secretRef) => {
    if (!isAllowedSecretName(secretRef?.name, allowed)) return null; // never read a non-allowed name
    return env[secretRef.name] ?? null;
  };
}

// --------------------------------------------------------------------------------------------
// Endpoint SSRF guard. Mirrors services/workflow-worker/src/activities/ssrf.mjs: numeric-IPv4
// normalization (inet_aton semantics) so a decimal/octal/hex-encoded link-local literal is
// caught BEFORE any DNS/socket activity, then DNS resolution + per-address blocklist re-check.
// --------------------------------------------------------------------------------------------

/**
 * Normalize a numeric-encoded IPv4 host (decimal/octal/hex, 1–4 dotted parts) to canonical
 * dotted-quad form. Returns null when the host is not a numeric IPv4. Kept byte-for-byte in
 * step with the worker SSRF guard so a decimal link-local (2852039166 → 169.254.169.254) is
 * normalized identically on both outbound-HTTP codepaths.
 */
function normalizeNumericIPv4(host) {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = [];
  for (const part of parts) {
    if (part === '') return null;
    let n;
    if (/^0x[0-9a-f]+$/i.test(part)) n = parseInt(part, 16);
    else if (/^0[0-9]+$/.test(part)) n = parseInt(part, 8);
    else if (/^[0-9]+$/.test(part)) n = parseInt(part, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  let addr32;
  if (nums.length === 1) {
    addr32 = nums[0];
    if (addr32 > 0xffffffff) return null;
  } else if (nums.length === 2) {
    if (nums[0] > 0xff || nums[1] > 0xffffff) return null;
    addr32 = (nums[0] << 24) | nums[1];
  } else if (nums.length === 3) {
    if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff) return null;
    addr32 = (nums[0] << 24) | (nums[1] << 16) | nums[2];
  } else {
    if (nums.some((n) => n > 0xff)) return null;
    addr32 = (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3];
  }
  addr32 = addr32 >>> 0;
  return [(addr32 >>> 24) & 0xff, (addr32 >>> 16) & 0xff, (addr32 >>> 8) & 0xff, addr32 & 0xff].join('.');
}

async function defaultEndpointResolver(hostname) {
  const results = await dns.promises.lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

const endpointBlocked = (detail) =>
  clientError(`BYOK provider endpoint is not allowed (SSRF guard): ${detail}`, 400, 'BYOK_ENDPOINT_BLOCKED');

/**
 * Validate a BYOK provider `endpoint` against the SSRF guard. Fail-closed: a malformed URL, a
 * non-http(s) scheme, `localhost`, an IP literal (any encoding) in a blocked range, an
 * unresolvable host, or ANY resolved address in a blocked range throws
 * clientError 400 BYOK_ENDPOINT_BLOCKED and NO request is sent.
 *
 * Optional operator allow-list (`BYOK_ENDPOINT_ALLOWED_HOSTS`): when set, the host must match
 * one suffix AND still pass the blocklist.
 *
 * The DNS resolver is injectable (default dns.promises.lookup) so tests run offline/deterministic.
 *
 * @param {string} endpoint
 * @param {{ resolver?: (hostname: string) => Promise<string[]>, env?: Record<string,string|undefined>, allowedHosts?: string[] }} [options]
 * @returns {Promise<void>}
 */
export async function assertEndpointAllowed(endpoint, options = {}) {
  const env = options.env ?? process.env;
  const resolver = options.resolver ?? defaultEndpointResolver;
  const allowedHosts = options.allowedHosts ?? parseAllowedEndpointHosts(env);

  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw endpointBlocked('endpoint is missing');
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw endpointBlocked('endpoint URL is malformed');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw endpointBlocked(`scheme ${parsed.protocol} is not allowed`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const lowerHost = hostname.toLowerCase();

  // Operator host allow-list (suffix match), when configured. Checked before the blocklist so a
  // misconfigured allow-list can never bypass the blocklist below.
  if (allowedHosts.length > 0) {
    const ok = allowedHosts.some((suffix) => lowerHost === suffix || lowerHost.endsWith(`.${suffix}`));
    if (!ok) throw endpointBlocked(`host ${hostname} is not in BYOK_ENDPOINT_ALLOWED_HOSTS`);
  }

  if (lowerHost === 'localhost') {
    throw endpointBlocked('localhost is blocked');
  }

  // IP literal (including numeric/decimal/hex encodings) → check directly, no DNS.
  const canonicalIPv4 = normalizeNumericIPv4(hostname);
  if (canonicalIPv4 !== null) {
    if (isBlockedIp(canonicalIPv4)) throw endpointBlocked('target is a blocked IP address');
    return;
  }
  if (net.isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) throw endpointBlocked('target is a blocked IP address');
    return;
  }

  // DNS hostname: resolve fail-closed and re-check EVERY resolved address (rebinding defense).
  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw endpointBlocked(`host ${hostname} could not be resolved`);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw endpointBlocked(`host ${hostname} resolved to no addresses`);
  }
  const normalized = addresses.map((a) => (typeof a === 'string' ? a : a?.address)).filter(Boolean);
  if (normalized.length === 0) {
    throw endpointBlocked(`host ${hostname} resolved to no addresses`);
  }
  if (normalized.some((addr) => isBlockedIp(addr))) {
    throw endpointBlocked(`host ${hostname} resolved to a blocked address`);
  }
}
