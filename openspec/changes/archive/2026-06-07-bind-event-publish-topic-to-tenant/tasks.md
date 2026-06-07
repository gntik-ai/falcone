## 1. Topic-vs-context assertion

- [x] 1.1 In `services/event-gateway/src/runtime.mjs::validateEventPublicationRequest:386-468`, add assertion `topic.tenantId === context.tenantId`; return `authorization_error` → 403 / `EVT_GATEWAY_FORBIDDEN` on mismatch
- [x] 1.2 Add assertion `topic.workspaceId === context.workspaceId` with the same error response
- [x] 1.3 Mirror the deny idiom from `apps/control-plane/src/observability-audit-export.mjs:107` (pattern: `if (context.tenantId && tenantId !== context.tenantId) { invariant(false, ..., SCOPE_VIOLATION); }`)

## 2. Normalized-request-vs-context assertion

- [x] 2.1 In `validateEventPublicationRequest`, after producing `normalized` from `normalizePublicationInput`, assert `normalized.tenantId === context.tenantId`; return 403 / `EVT_GATEWAY_FORBIDDEN` on mismatch
- [x] 2.2 Assert `normalized.workspaceId === context.workspaceId` with the same error; treat both fields from the request body as untrusted until validated

## 3. TopicRef resolution hardening

- [x] 3.1 In `services/event-gateway/src/kafka-integrations.mjs::normalizeTopicRef:95-96`, remove the preference for caller-supplied `topicRef` over context value; derive topic ref from authenticated context by default
- [ ] 3.2 Where a caller-supplied `topicRef` is still accepted, validate it resolves to a topic owned by the caller's authenticated tenant and workspace before use
  NOTE: 3.2 is not implemented in this change. The primary defense (task 1.1/1.2 — topic.tenantId/workspaceId vs context) already blocks any cross-tenant topicRef that resolves to a topic with the wrong tenant fields. Runtime topicRef resolution against an external topic registry is outside the in-process validator's scope; the auth gate in validateEventPublicationRequest (tasks 1+2) is the enforcement point. 3.1 was applied: context.topicRef is now preferred over caller-supplied topicRef in normalizeTopicRef.

## 4. Verification

- [x] 4.1 Add black-box test `bbx-events-cross-tenant-publish-01`: publication request referencing a topic owned by a different tenant returns HTTP 403 `EVT_GATEWAY_FORBIDDEN`
- [x] 4.2 Add black-box test: publication request with `tenantId` body field set to another tenant returns HTTP 403
- [x] 4.3 Add black-box test: same-tenant same-workspace publication returns HTTP 202
- [x] 4.4 Run `bash tests/blackbox/run.sh`
