## Why

`webhook-subscription.mjs::validateSubscriptionInput` (lines 154-214) performs DNS resolution and blocks private/SSRF-candidate IPs at subscription-creation time. `isBlockedIp` is exported with a JSDoc comment stating it is "for reuse in delivery-time re-validation" (line 89). However, `webhook-delivery.mjs` — the source module that builds delivery and attempt records — contains no egress client that re-resolves the target hostname or calls `isBlockedIp` before sending. The delivery worker that actually issues the HTTP POST is not present in the audited source.

The gap is: DNS TTL-0 rebinding allows a hostname to resolve to a public IP at subscription time (passing validation) and then resolve to `169.254.169.254`, `127.0.0.1`, or an RFC1918 address at delivery time. Without delivery-time re-resolution and IP pinning, the subscription-time blocklist is bypassable.

This is a residual gap from PR #216 (`harden-webhook-ssrf-guard`, CLOSED), which hardened subscription-time validation only.

## What Changes

- Require that the webhook delivery client (wherever it lives — in the delivery worker that consumes the delivery queue) re-resolves the target hostname immediately before opening the HTTP connection, calls `isBlockedIp` on every resolved address, and connects only to the pinned validated IP (overriding system DNS at connect time, e.g. via a custom `lookup` function or a pre-resolved `agent`).
- Require that the delivery client rejects any HTTP redirect whose `Location` header resolves to a blocked IP (redirect SSRF guard).
- Document the coverage gap: the delivery worker is absent from source; the requirement is specified here so that when the worker is implemented (or found in a deployment artifact), the re-pin behavior is testable.
- Add a rejection scenario encoded as `bbx-webhook-rebind` for the contract suite.

## Capabilities

### New Capabilities

- `webhooks`: Webhook delivery enforces SSRF protection at send time by re-resolving the target hostname and blocking delivery if any resolved address is in a blocked range, preventing DNS-rebinding attacks that bypass subscription-time validation.

### Modified Capabilities

## Impact

- `services/webhook-engine/src/webhook-delivery.mjs` — no egress re-resolution or `isBlockedIp` call exists (coverage gap)
- `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` (line 91) — exported but has no caller in the delivery path
- Delivery worker (absent from source) — MUST implement re-resolution + IP pinning
