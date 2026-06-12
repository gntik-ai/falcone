// events.publish activity (change: add-flows-activity-catalog / #360).
//
// Publishes one or more messages to a workspace-scoped logical topic via the events
// executor (operation `publish`). Topic isolation is structural: the executor maps the
// logical topic to the physical `evt.<workspaceId>.<topic>` (events-executor.mjs
// `physicalTopic`), so an activity can only publish to its own workspace's topics. An
// empty `messages` array fails NON-retryably BEFORE any Kafka call (no point retrying a
// deterministic input error); a broker error from the executor (502 KAFKA_ERROR) is
// retryable.
import { assertPayloadSize } from './limits.mjs';
import { toNonRetryable, toRetryable, classifyExecutorError } from './errors.mjs';

/**
 * @param {{ params: object, tenant: object, credential?: object }} input
 *   params: { topic, messages: [{ key?, value }] }
 * @param {{ executeEvents?: Function }} deps
 */
export async function eventsPublish(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  const credential = input.credential ?? {};
  if (!tenant.tenantId) throw toNonRetryable('UNAUTHENTICATED', 'events.publish requires a tenant context');
  const workspaceId = params.workspaceId ?? tenant.workspaceId;
  if (!workspaceId) throw toNonRetryable('UNAUTHENTICATED', 'events.publish requires a workspaceId');
  if (!params.topic) throw toNonRetryable('VALIDATION_ERROR', 'events.publish requires a topic');

  const messages = Array.isArray(params.messages) ? params.messages : [];
  // Fail-fast BEFORE any Kafka call (tasks 7.3).
  if (messages.length === 0) {
    throw toNonRetryable('EMPTY_PUBLISH', 'events.publish requires at least one message');
  }

  if (typeof deps.executeEvents !== 'function') {
    throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'events executor not wired into events.publish activity');
  }

  const identity = { tenantId: tenant.tenantId, workspaceId, roleName: credential.roleName ?? 'falcone_service' };

  let result;
  try {
    result = await deps.executeEvents({
      operation: 'publish',
      workspaceId,
      topic: params.topic,
      payload: { messages },
      identity,
    });
  } catch (err) {
    if (err?.name === 'ApplicationFailure') throw err;
    // Kafka broker failure → 502 KAFKA_ERROR from the executor → retryable.
    if (err?.code === 'KAFKA_ERROR' || err?.statusCode === 502) {
      throw toRetryable('BROKER_UNAVAILABLE', err?.message ?? 'kafka broker unavailable');
    }
    throw classifyExecutorError(err, { EMPTY_PUBLISH: 'EMPTY_PUBLISH' });
  }

  const output = { status: 'success', topic: result?.topic ?? params.topic, published: result?.published ?? messages.length };
  assertPayloadSize(output, 'output');
  return output;
}

export const eventsPublishInputSchema = Object.freeze({
  $id: 'flows/activity/events.publish/input',
  type: 'object',
  required: ['topic', 'messages'],
  properties: {
    topic: { type: 'string' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: {} },
      },
    },
  },
  additionalProperties: false,
});

export const eventsPublishOutputSchema = Object.freeze({
  $id: 'flows/activity/events.publish/output',
  type: 'object',
  required: ['status', 'topic', 'published'],
  properties: {
    status: { type: 'string', const: 'success' },
    topic: { type: 'string' },
    published: { type: 'integer' },
  },
  additionalProperties: false,
});
