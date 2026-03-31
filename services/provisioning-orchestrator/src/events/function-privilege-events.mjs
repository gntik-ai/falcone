export const TOPICS = Object.freeze({
  DENIED: process.env.FUNCTION_PRIVILEGE_KAFKA_TOPIC_DENIED || 'console.security.function-privilege-denied',
  ASSIGNED: process.env.FUNCTION_PRIVILEGE_KAFKA_TOPIC_ASSIGNED || 'console.security.function-privilege-assigned',
  REVIEW_NOTICE: process.env.FUNCTION_PRIVILEGE_KAFKA_TOPIC_REVIEW_NOTICE || 'console.security.function-privilege-review-notice'
});

function stamp(eventType, payload) {
  return { eventType, ...payload, occurredAt: new Date().toISOString() };
}

export function buildFunctionPrivilegeDeniedEvent(payload) {
  return stamp('function_privilege_denied', payload);
}

export function buildFunctionPrivilegeAssignedEvent(payload) {
  return stamp('function_privilege_assigned', payload);
}

export function buildFunctionPrivilegeReviewNoticeEvent(payload) {
  return stamp('function_privilege_review_notice', payload);
}
