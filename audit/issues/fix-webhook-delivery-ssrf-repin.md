# Webhook SSRF guard is validation-time only; no delivery-time IP re-pin (DNS rebinding)

> Relates to #216 (harden-webhook-ssrf-guard, CLOSED) — that fix hardened SUBSCRIPTION-time IP validation only; delivery-time re-resolution/pinning (DNS-rebinding defense) remains unimplemented. Consider reopening #216 or tracking here.

| Field | Value |
|---|---|
| Change ID | `fix-webhook-delivery-ssrf-repin` |
| Capability | `webhooks` |
| Type | bug |
| Priority | P2 |
| OpenSpec change | `openspec/changes/fix-webhook-delivery-ssrf-repin/` |

## Why

`webhook-subscription.mjs::validateSubscriptionInput` (lines 154-214) resolves DNS and blocks private/SSRF-candidate IPs at subscription-creation time. `isBlockedIp` is exported from the same module with an explicit JSDoc: "Exported for reuse in delivery-time re-validation" (line 89). However, `webhook-delivery.mjs` — the module that builds delivery and attempt records — contains no HTTP egress client, no hostname re-resolution, and no call to `isBlockedIp`. The webhook delivery worker (the process that actually issues HTTP POST requests) is absent from the audited source tree.

Attack model (DNS rebinding / TTL=0): the attacker registers a hostname they control. At subscription time it resolves to a public IP — the SSRF guard passes. Before delivery, the attacker updates the DNS record to `169.254.169.254` (or any RFC1918 / loopback address). The delivery worker resolves the hostname fresh and connects to the metadata endpoint, potentially leaking cloud credentials. Without delivery-time re-resolution and IP pinning the subscription-time guard is bypassable.

A secondary vector is redirect SSRF: the target server redirects to an internal URL; without redirect validation the delivery client follows the redirect into the private network.

## What Changes

- Require the webhook delivery client to re-resolve the target hostname immediately before each outbound connection and call `isBlockedIp` on every resolved address; abort the delivery as `permanently_failed` if any address is blocked.
- Require IP pinning: connect the HTTP client to the specific validated IP (e.g., via a custom `lookup` callback or pre-resolved agent) to eliminate the TOCTOU window between re-validation and the `connect` syscall.
- Require redirect SSRF guard: either disable automatic redirect following or re-validate each redirect `Location` hostname before following.
- Document the delivery worker absence as a coverage gap; the `bbx-webhook-rebind` test encodes the contract for when the worker is implemented.

## Spec delta (EARS)

From `openspec/changes/fix-webhook-delivery-ssrf-repin/specs/webhooks/spec.md`:

**Requirement: Webhook delivery client MUST re-resolve the target hostname and block delivery if any resolved IP is in a blocked range**

The system SHALL, immediately before opening a connection to the webhook target URL, perform a fresh DNS resolution of the target hostname and call `isBlockedIp` on every resolved address; if any resolved address is blocked, the system SHALL abort the delivery attempt, record the outcome as `permanently_failed` with `error_detail` indicating SSRF guard rejection, and SHALL NOT open the network connection.

**Scenario: Delivery is rejected when target hostname re-resolves to a private IP at send time (bbx-webhook-rebind)**

- WHEN a webhook subscription was registered with a hostname that resolved to a public IP at subscription time, and at delivery time that hostname resolves to a blocked IP address
- THEN the delivery worker refuses to open the HTTP connection, records the delivery attempt as `permanently_failed`, and does not emit the webhook payload

**Requirement: Webhook delivery client MUST connect to the pinned validated IP address**

The system SHALL connect the HTTP client to the specific IP address resolved and validated at delivery time (IP pinning), bypassing further OS-level DNS resolution for that connection.

**Requirement: Webhook delivery client MUST refuse HTTP redirects that resolve to a blocked IP**

The system SHALL disable automatic HTTP redirect following OR validate every redirect `Location` header; if the redirect target resolves to a blocked IP the delivery SHALL be aborted as `permanently_failed`.

## Tasks

From `openspec/changes/fix-webhook-delivery-ssrf-repin/tasks.md`:

- [ ] 1.1 Add test `bbx-webhook-rebind` — subscription passes with public IP; at delivery time inject private IP resolution; assert `permanently_failed`
- [ ] 1.2 Add positive delivery test — hostname re-resolves to same public IP; delivery proceeds
- [ ] 1.3 Add redirect SSRF test — redirect `Location` resolves to blocked IP; assert `permanently_failed`
- [ ] 1.4 Run `bash tests/blackbox/run.sh` and confirm `bbx-webhook-rebind` FAILS (or is marked pending due to delivery worker absence)
- [ ] 2.1 Import `isBlockedIp` into the delivery worker from `webhook-subscription.mjs`
- [ ] 2.2 Before each HTTP connection: re-resolve hostname, call `isBlockedIp` on all results, abort if any blocked
- [ ] 2.3 Pin the HTTP connection to the validated IP via custom `lookup` callback or pre-resolved agent
- [ ] 2.4 Disable auto-redirects OR add redirect SSRF validator
- [ ] 3.1-3.4 Run `bash tests/blackbox/run.sh` — all three tests green

## Acceptance criteria

- `bbx-webhook-rebind`: delivery to a hostname that DNS-rebinds to a private IP at send time results in `permanently_failed` with no outbound HTTP connection
- IP pinning: no second OS-level DNS resolution occurs between re-validation and the TCP `connect`
- Redirect SSRF: redirect chains that lead to a blocked IP are refused
- Subscription-time validation is unchanged and continues to pass for legitimate public HTTPS targets

## Code evidence

- `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` (line 91) — exported but has no caller in the delivery path
- `services/webhook-engine/src/webhook-subscription.mjs::validateSubscriptionInput` (lines 154-214) — DNS resolution + blocklist check at subscription time only
- `services/webhook-engine/src/webhook-delivery.mjs` (entire file) — record builders only; no HTTP egress client, no `isBlockedIp` call, no DNS re-resolution

Coverage gap: the delivery worker that issues HTTP POST requests is absent from the audited source tree. The requirement is specified here so that any implementation has a testable contract.

## Resolution (OpenSpec)

```
/opsx:apply fix-webhook-delivery-ssrf-repin
/opsx:verify fix-webhook-delivery-ssrf-repin
bash tests/blackbox/run.sh
/opsx:archive fix-webhook-delivery-ssrf-repin
```

Or use the wrapper: `/fix-bug fix-webhook-delivery-ssrf-repin`

Optional real-stack E2E: `/e2e-issue fix-webhook-delivery-ssrf-repin`

For the E2E reproduction (once delivery worker is available): `bash tests/e2e/run-issue.sh fix-webhook-delivery-ssrf-repin`
