## Why

`services/webhook-engine/src/webhook-subscription.mjs::isPrivateHostname:9-17` is the sole SSRF guard. It contains five confirmed gaps:

1. IPv4 link-local `169.254.0.0/16` (including `169.254.169.254` — AWS/GCP/Azure instance-metadata) is not blocked; it passes all prefix checks and returns `false`.
2. `0.0.0.0` passes `net.isIP` and none of the prefix checks; it routes to localhost on most OS stacks.
3. Numeric-encoded IPs (decimal `2852039166`, octal, hex) return `0` from `net.isIP`, causing the guard to short-circuit at line 12 and return `false` (public) even when they encode a blocked address.
4. DNS hostnames are accepted without resolution; a public DNS name resolving to `169.254.169.254` passes unconditionally.
5. IPv6 `::` and `::ffff:169.254.x.x` are not handled.

Validation is create-time only (`validateSubscriptionInput:19-39`). No delivery-time re-validation exists, leaving DNS-rebinding attacks unaddressed (source finding `bug-014`).

## What Changes

- Extend `isPrivateHostname` to block: `169.254.0.0/16`, `0.0.0.0`/`0.0.0.0/8`, `::`, `::ffff:169.254.x.x`.
- Normalize numeric-encoded IPs (decimal, octal, hex) to canonical dotted-decimal before range checks.
- For DNS hostnames: perform DNS resolution in `validateSubscriptionInput`; check all resolved IPs against the complete blocklist; reject if any resolved IP is blocked or if resolution fails (fail-closed).
- At delivery time (out-of-module): re-resolve the hostname, re-validate all IPs, pin the connection to the validated IP; abort and record permanent failure if re-resolution yields a blocked address.

## Capabilities

### New Capabilities

- `webhooks`: Complete SSRF guard for webhook URL validation, covering all address-encoding forms, DNS resolution at registration, and delivery-time re-validation with IP pinning.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the webhooks capability spec -->

## Impact

- `services/webhook-engine/src/webhook-subscription.mjs::isPrivateHostname:9-17` — MODIFIED (add `169.254.x.x`, `0.0.0.0`, `::`, `::ffff:169.254.x.x`, numeric normalization)
- `services/webhook-engine/src/webhook-subscription.mjs::validateSubscriptionInput:19-39` — MODIFIED (add DNS resolution and resolved-IP blocklist check)
- Delivery component (outside `webhook-engine/src`, location suspected) — MODIFIED (delivery-time re-resolve, re-validate, IP pinning)
- Black-box suite: new SSRF rejection tests for `169.254.169.254`, `0.0.0.0`, `2852039166`, and a DNS name resolving to a blocked address
