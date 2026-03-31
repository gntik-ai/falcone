/**
 * Generic HTTP client for gateway and control plane requests.
 * Includes retry with exponential backoff for transient 5xx errors.
 */

import { env } from '../config/test-env.mjs';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} path
 * @param {object} opts
 * @param {string} opts.token
 * @param {object} [opts.body]
 * @param {Record<string,string>} [opts.headers]
 * @returns {Promise<{ status: number, headers: Headers, body: any }>}
 */
async function request(baseUrl, method, path, opts) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    ...opts.headers,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => '');

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
      continue;
    }

    return { status: res.status, headers: res.headers, body };
  }

  // Should not reach here, but satisfy TS/linter:
  throw new Error(`request to ${url} exhausted retries`);
}

/**
 * Make a request to the APISIX gateway.
 */
export function gatewayRequest(method, path, opts) {
  return request(env.GATEWAY_BASE_URL, method, path, opts);
}

/**
 * Make a request to the control plane.
 */
export function controlPlaneRequest(method, path, opts) {
  return request(env.CONTROL_PLANE_URL, method, path, opts);
}
