import crypto from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns';
import { isValidEventType } from './event-catalogue.mjs';

function uuid() {
  return crypto.randomUUID();
}

/**
 * Normalize a value that may be a numeric IPv4 address in any encoding
 * (decimal, octal with 0-prefix, hex with 0x-prefix, or dotted variants)
 * to canonical dotted-quad form. Returns null if it cannot be interpreted
 * as an IPv4 address.
 *
 * Follows inet_aton semantics: 1–4 dot-separated parts.
 *   4 parts: a.b.c.d
 *   3 parts: a.b.cd  (cd = 16-bit last segment)
 *   2 parts: a.bcd   (bcd = 24-bit last segment)
 *   1 part:  abcd    (32-bit integer)
 */
function normalizeNumericIPv4(host) {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const nums = [];
  for (const part of parts) {
    if (part === '') return null;
    let n;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      n = parseInt(part, 16);
    } else if (/^0[0-9]+$/.test(part)) {
      n = parseInt(part, 8);
    } else if (/^[0-9]+$/.test(part)) {
      n = parseInt(part, 10);
    } else {
      return null; // contains non-numeric characters
    }
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  let addr32;
  if (nums.length === 1) {
    // Pure 32-bit integer
    addr32 = nums[0];
    if (addr32 > 0xFFFFFFFF) return null;
  } else if (nums.length === 2) {
    if (nums[0] > 0xFF || nums[1] > 0xFFFFFF) return null;
    addr32 = (nums[0] << 24) | nums[1];
  } else if (nums.length === 3) {
    if (nums[0] > 0xFF || nums[1] > 0xFF || nums[2] > 0xFFFF) return null;
    addr32 = (nums[0] << 24) | (nums[1] << 16) | nums[2];
  } else {
    // 4 parts
    if (nums.some((n) => n > 0xFF)) return null;
    addr32 = (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3];
  }

  // Convert back to unsigned 32-bit then to dotted-quad
  addr32 = addr32 >>> 0;
  return [
    (addr32 >>> 24) & 0xFF,
    (addr32 >>> 16) & 0xFF,
    (addr32 >>> 8) & 0xFF,
    addr32 & 0xFF
  ].join('.');
}

/**
 * Check whether a canonical dotted-quad IPv4 string falls in a blocked range.
 * Ranges: 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16,
 *         172.16.0.0/12, 192.168.0.0/16.
 */
function isBlockedIPv4(dotted) {
  const parts = dotted.split('.').map(Number);
  const a = parts[0], b = parts[1];
  if (a === 0) return true;               // 0.0.0.0/8
  if (a === 10) return true;              // 10.0.0.0/8
  if (a === 127) return true;             // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * Check whether a single IP string (IPv4 or IPv6, canonical form) is blocked.
 * Exported for reuse in delivery-time re-validation.
 */
export function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIPv4(ip);
  if (v === 6) {
    const h = ip.toLowerCase();
    if (h === '::' || h === '::0' || h === '0:0:0:0:0:0:0:0') return true; // unspecified
    if (h === '::1') return true; // loopback

    // IPv4-mapped: ::ffff:a.b.c.d
    const mappedDotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isBlockedIPv4(mappedDotted[1]);

    // IPv4-mapped hex: ::ffff:aabb:ccdd
    const mappedHex = h.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const dotted = `${(hi >> 8) & 0xFF}.${hi & 0xFF}.${(lo >> 8) & 0xFF}.${lo & 0xFF}`;
      return isBlockedIPv4(dotted);
    }

    // fc00::/7 (ULA: fc and fd prefixes)
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    // fe80::/10 (link-local)
    if (h.startsWith('fe80:') || h.startsWith('fe8') || h.startsWith('fe9') ||
        h.startsWith('fea') || h.startsWith('feb')) return true;
    return false;
  }
  return false;
}

/**
 * Check whether the host portion of a URL is a private/blocked address.
 * Works on canonical IP literals (after numeric normalization).
 * For real DNS names, returns false — DNS resolution is done separately.
 */
function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost') return true;

  // Try to interpret as an IPv4 (possibly numeric-encoded)
  const canonical = normalizeNumericIPv4(host);
  if (canonical !== null) return isBlockedIPv4(canonical);

  // Check if it's a canonical IPv6
  if (net.isIP(host) === 6) return isBlockedIp(host);

  return false;
}

/**
 * Default DNS resolver: looks up all A/AAAA addresses for hostname.
 */
async function defaultResolver(hostname) {
  const results = await dns.promises.lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/**
 * Validate a subscription input. Now async to support DNS resolution.
 * options.resolver: async (hostname) => string[]  (injectable for tests)
 */
export async function validateSubscriptionInput({ targetUrl, eventTypes }, options = {}) {
  const resolver = options.resolver ?? defaultResolver;

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    const error = new Error('Malformed target URL');
    error.code = 'INVALID_URL';
    throw error;
  }

  if (parsed.protocol !== 'https:') {
    const error = new Error('Webhook target must be public HTTPS');
    error.code = 'INVALID_URL';
    throw error;
  }

  // Strip IPv6 brackets from hostname
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // Determine if the host is an IP literal in any encoding
  const canonicalIPv4 = normalizeNumericIPv4(hostname);
  const isIPLiteral = canonicalIPv4 !== null || net.isIP(hostname) !== 0;

  if (isIPLiteral) {
    // For IP literals, run direct blocklist check (no DNS)
    if (isPrivateHostname(parsed.hostname)) {
      const error = new Error('Webhook target must be public HTTPS');
      error.code = 'INVALID_URL';
      throw error;
    }
  } else {
    // DNS hostname: resolve and check all resulting IPs (fail-closed)
    let addresses;
    try {
      addresses = await resolver(hostname);
    } catch {
      const error = new Error('Webhook target hostname could not be resolved');
      error.code = 'INVALID_URL';
      throw error;
    }
    if (!addresses || addresses.length === 0) {
      const error = new Error('Webhook target hostname resolved to no addresses');
      error.code = 'INVALID_URL';
      throw error;
    }
    if (addresses.some((ip) => isBlockedIp(ip))) {
      const error = new Error('Webhook target resolved to a blocked address');
      error.code = 'INVALID_URL';
      throw error;
    }
  }

  if (!Array.isArray(eventTypes) || eventTypes.length === 0 || eventTypes.some((item) => !isValidEventType(item))) {
    const error = new Error('Unknown event types');
    error.code = 'INVALID_EVENT_TYPES';
    throw error;
  }
  return { targetUrl: parsed.toString(), eventTypes: [...new Set(eventTypes)] };
}

export async function buildSubscriptionRecord(input, context) {
  const validated = await validateSubscriptionInput(input, { resolver: context.resolver });
  const now = new Date().toISOString();
  return {
    id: uuid(),
    tenant_id: context.tenantId,
    workspace_id: context.workspaceId,
    target_url: validated.targetUrl,
    event_types: validated.eventTypes,
    status: 'active',
    consecutive_failures: 0,
    max_consecutive_failures: context.maxConsecutiveFailures ?? 5,
    description: input.description ?? null,
    metadata: input.metadata ?? {},
    created_by: context.actorId,
    created_at: now,
    updated_at: now,
    deleted_at: null
  };
}

const TRANSITIONS = {
  active: new Set(['paused', 'disabled', 'deleted']),
  paused: new Set(['active', 'deleted']),
  disabled: new Set(['active', 'deleted']),
  deleted: new Set()
};

export function canTransition(currentStatus, targetStatus) {
  return TRANSITIONS[currentStatus]?.has(targetStatus) ?? false;
}

export function applyStatusTransition(subscription, status) {
  if (!canTransition(subscription.status, status)) {
    const error = new Error(`Cannot transition ${subscription.status} to ${status}`);
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }
  return { ...subscription, status, updated_at: new Date().toISOString() };
}

export function softDelete(subscription) {
  return { ...applyStatusTransition(subscription, 'deleted'), deleted_at: new Date().toISOString() };
}
