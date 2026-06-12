// email.send activity STUB (change: add-flows-activity-catalog / #360).
//
// D5: no platform SMTP capability exists anywhere in services/ or apps/ (confirmed). The
// task type is REGISTERED so DSL validation (FLW-E006) and the console palette surface its
// name, but invocation ALWAYS fails non-retryably with CAPABILITY_UNAVAILABLE — it never
// silently succeeds. When a real SMTP capability is provisioned this stub is replaced.
import { toNonRetryable } from './errors.mjs';

const UNAVAILABLE_MESSAGE = 'email.send is not available: no platform SMTP configuration';

/**
 * @param {{ params?: object, tenant?: object }} _input
 * @param {{ smtp?: object }} [deps]
 */
export async function emailSend(_input, deps = {}) {
  // The seam for the future SMTP backend: when a real config is injected, this is where the
  // send would happen. Until then the stub fails fast and loud.
  if (deps?.smtp) {
    throw toNonRetryable('CAPABILITY_UNAVAILABLE', `${UNAVAILABLE_MESSAGE} (smtp backend not yet implemented)`);
  }
  throw toNonRetryable('CAPABILITY_UNAVAILABLE', UNAVAILABLE_MESSAGE);
}

export const emailSendInputSchema = Object.freeze({
  $id: 'flows/activity/email.send/input',
  type: 'object',
  required: ['to', 'subject'],
  properties: {
    to: { type: 'array', items: { type: 'string' } },
    subject: { type: 'string' },
    body: { type: 'string' },
    from: { type: 'string' },
  },
  additionalProperties: false,
});

export const emailSendOutputSchema = Object.freeze({
  $id: 'flows/activity/email.send/output',
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['success'] },
    messageId: { type: 'string' },
  },
  additionalProperties: false,
});
