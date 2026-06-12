// SSRF guard for the `http.request` activity (change: add-flows-activity-catalog / #360).
//
// D2: the guard is IMPORTED from services/webhook-engine/src/webhook-subscription.mjs
// (`isBlockedIp`) rather than re-implemented, so the two outbound-HTTP codepaths stay in
// sync. `isBlockedIp` is a pure function covering RFC 1918, loopback, link-local
// (169.254.0.0/16 + fe80::/10), unspecified, ULA, IPv4-mapped IPv6, and numeric/decimal
// IPv4 encodings (via the URL host normalization below). This module adds the
// delivery-time DNS-rebinding re-check, mirroring webhook-delivery-worker.mjs
// `resolveDeliveryTarget` + IP pinning.
import dns from 'node:dns';
import net from 'node:net';
import { isBlockedIp } from '../../../webhook-engine/src/webhook-subscription.mjs';
import { toNonRetryable } from './errors.mjs';

/**
 * Normalize a numeric-encoded IPv4 host (decimal, octal, hex, dotted variants) to
 * canonical dotted-quad form per inet_aton semantics, mirroring the webhook guard so a
 * decimal-encoded link-local address (e.g. 2852039166 → 169.254.169.254) is caught BEFORE
 * any DNS or socket activity. Returns null when the host is not a numeric IPv4.
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

async function defaultResolver(hostname) {
  const results = await dns.promises.lookup(hostname, { all: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
}

/**
 * Validate a caller-supplied URL against the SSRF blocklist and pin the connection to a
 * single validated IP address (TOCTOU / DNS-rebinding defense). Fail-closed: a malformed
 * URL, a non-http(s) scheme, an unresolvable host, or any resolved address in a blocked
 * range throws a NON-retryable `SSRF_BLOCKED` failure and NO socket is opened.
 *
 * @param {string} url
 * @param {{ resolver?: (hostname: string) => Promise<Array> }} [options] injectable resolver (tests)
 * @returns {Promise<{ hostname: string, pinnedAddress: string, family: 4|6 }>}
 */
export async function resolveSsrfSafe(url, options = {}) {
  const resolver = options.resolver ?? defaultResolver;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw toNonRetryable('SSRF_BLOCKED', 'http.request target URL is malformed');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw toNonRetryable('SSRF_BLOCKED', `http.request scheme ${parsed.protocol} is not allowed`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // IP literal (including numeric/decimal/hex encodings) → check directly, pin to itself.
  const canonicalIPv4 = normalizeNumericIPv4(hostname);
  if (canonicalIPv4 !== null) {
    if (isBlockedIp(canonicalIPv4)) {
      throw toNonRetryable('SSRF_BLOCKED', 'http.request target is a blocked IP address');
    }
    return { hostname, pinnedAddress: canonicalIPv4, family: 4 };
  }
  const ipVersion = net.isIP(hostname);
  if (ipVersion !== 0) {
    if (isBlockedIp(hostname)) {
      throw toNonRetryable('SSRF_BLOCKED', 'http.request target is a blocked IP address');
    }
    return { hostname, pinnedAddress: hostname, family: ipVersion };
  }
  if (hostname.toLowerCase() === 'localhost') {
    throw toNonRetryable('SSRF_BLOCKED', 'http.request target localhost is blocked');
  }

  // DNS hostname: resolve fail-closed, re-check every resolved address (rebinding defense).
  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw toNonRetryable('SSRF_BLOCKED', `http.request target ${hostname} could not be resolved`);
  }
  if (!addresses || addresses.length === 0) {
    throw toNonRetryable('SSRF_BLOCKED', `http.request target ${hostname} resolved to no addresses`);
  }
  const entries = addresses.map((a) =>
    typeof a === 'string'
      ? { address: a, family: net.isIP(a) === 6 ? 6 : 4 }
      : { address: a.address, family: a.family ?? (net.isIP(a.address) === 6 ? 6 : 4) },
  );
  if (entries.some((e) => isBlockedIp(e.address))) {
    throw toNonRetryable('SSRF_BLOCKED', `http.request target ${hostname} resolved to a blocked address`);
  }
  const first = entries[0];
  return { hostname, pinnedAddress: first.address, family: first.family };
}
