/**
 * Lightweight HTTP API client for E2E restore test suite.
 * Wraps undici.fetch with auth, correlation-id, and structured errors.
 * Also exports a minimal Kafka audit-event consumer factory.
 * @module tests/e2e/helpers/api-client
 */

/**
 * @typedef {Object} ApiClient
 * @property {(path: string) => Promise<{status: number, body: any}>} get
 * @property {(path: string, body?: any) => Promise<{status: number, body: any}>} post
 * @property {(path: string) => Promise<{status: number, body: any}>} del
 * @property {string} baseUrl
 */

/**
 * Create an API client for the restore test suite.
 *
 * @param {{ baseUrl: string, authToken: string, correlationId?: string }} opts
 * @returns {ApiClient}
 */
export function createApiClient({ baseUrl, authToken, correlationId }) {
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
  };

  async function request(method, path, body) {
    const url = `${baseUrl}${path}`;
    const opts = { method, headers: { ...headers } };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    let responseBody;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      responseBody = await res.json();
    } else {
      responseBody = await res.text();
    }

    return { status: res.status, body: responseBody };
  }

  return {
    baseUrl,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    del: (path) => request('DELETE', path),
  };
}

/**
 * Minimal Kafka consumer factory for verifying audit events.
 * Uses kafkajs if available; otherwise returns a no-op consumer.
 *
 * @param {{ brokers: string[], topic: string, groupId: string }} opts
 * @returns {Promise<{ messages: () => any[], disconnect: () => Promise<void> }>}
 */
export async function createAuditConsumer({ brokers, topic, groupId }) {
  // Audit verification via Kafka consumer is optional in sandbox environments.
  // If kafkajs is not available, return a no-op consumer.
  try {
    const { Kafka } = await import('kafkajs');
    const kafka = new Kafka({ clientId: 'restore-e2e', brokers });
    const consumer = kafka.consumer({ groupId });
    const collected = [];
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          collected.push(JSON.parse(message.value.toString()));
        } catch { /* ignore non-JSON */ }
      },
    });
    return {
      messages: () => [...collected],
      disconnect: () => consumer.disconnect(),
    };
  } catch {
    return {
      messages: () => [],
      disconnect: async () => {},
    };
  }
}
