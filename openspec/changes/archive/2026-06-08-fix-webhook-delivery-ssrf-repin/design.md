## Context

PR #216 (`harden-webhook-ssrf-guard`, CLOSED) added subscription-time SSRF validation: `validateSubscriptionInput` now resolves the target hostname DNS and rejects any IP that `isBlockedIp` classifies as private or loopback. The `isBlockedIp` function is explicitly exported for reuse ("Exported for reuse in delivery-time re-validation", line 89 of webhook-subscription.mjs).

However, `webhook-delivery.mjs` — the module responsible for building delivery records and attempt records — contains no HTTP egress client, no DNS re-resolution, and no call to `isBlockedIp`. The actual delivery worker (the process that reads from the delivery queue and issues HTTP POSTs) is not present in the audited source tree.

DNS rebinding attack model: an attacker registers a domain they control with a low or zero TTL. At subscription creation time the domain resolves to a public IP (e.g., `203.0.113.1`), passing the SSRF check. By delivery time, the attacker updates the DNS record to point to `169.254.169.254` (AWS metadata). The delivery worker performs a DNS lookup and connects to the metadata endpoint, potentially leaking cloud credentials.

Two secondary vectors:
1. **TOCTOU (re-resolution without pinning):** Even if the delivery worker re-resolves and checks the IP, a second OS-level DNS call inside the HTTP stack (before the `connect` syscall) could return a different address. Pinning (connecting directly to the validated IP) eliminates this race.
2. **Redirect SSRF:** The target server redirects to an internal URL. Without redirect SSRF guards, the delivery client follows the redirect into the private network.

## Goals / Non-Goals

**Goals:**
- Specify delivery-time re-resolution + `isBlockedIp` check as a MUST requirement.
- Specify IP pinning to close the TOCTOU gap.
- Specify redirect SSRF guard.
- Encode the `bbx-webhook-rebind` rejection scenario in the spec.
- Flag the delivery worker absence as a coverage gap in all artifacts.

**Non-Goals:**
- Implementing the delivery worker (it is absent from source; the requirement is specified for when it exists).
- Changing the subscription-time validation (already correct per PR #216).
- Changing the `isBlockedIp` function signature (it is reuse-ready).

## Decisions

**Decision: Require IP pinning in addition to re-validation.**
Rationale: Re-validating without pinning leaves a narrow TOCTOU window where a second DNS resolution inside the HTTP stack could return a different address. Pinning is the industry-standard defense (used by SSRF-safe HTTP libraries such as `ssrffilter`, SafeCURL, etc.).

**Decision: Treat redirect SSRF as part of this fix.**
Rationale: Redirect SSRF is the second most common bypass after DNS rebinding; both share the same root cause (trust of the final destination is not re-verified after an intermediate hop).

**Decision: Document the delivery worker absence as a coverage gap.**
Rationale: Without the delivery worker in source, the fix cannot be fully implemented in this workspace. The requirement is specified here so that any future implementation of the delivery worker has a testable contract.

## Risks / Trade-offs

**Risk:** The delivery worker may be in a private deployment repo or a different service boundary; the spec cannot be verified against source today.
**Mitigation:** The coverage gap is documented explicitly in all artifacts. The `bbx-webhook-rebind` test encodes the contract so that when the worker is available it can be exercised.

**Risk:** IP pinning may be incompatible with some CDN/load-balancer configurations where the public IP changes between requests by design.
**Mitigation:** The re-validation step should be per-delivery-attempt, not per-subscription. If a CDN rotates IPs, each resolved IP must pass `isBlockedIp` individually. This is the correct behavior.

**Risk:** Disabling redirects may break some legitimate webhook consumers that use redirects.
**Mitigation:** The spec permits redirect following provided each hop is re-validated. Alternatively, follow only HTTPS redirects to validated non-blocked IPs and abort on any other redirect.

## Migration Plan

No schema changes. Changes are localized to the delivery worker (when it exists):

1. Before opening any HTTP connection to a webhook target: resolve the hostname, run `isBlockedIp` on all results, abort if any blocked.
2. Use a custom `lookup` function or pre-resolved agent to pin the connection to the validated IP.
3. Either disable redirects or validate each redirect `Location` before following.
4. Import `isBlockedIp` from `webhook-subscription.mjs` (already exported for this purpose).
5. Add `bbx-webhook-rebind` contract test with a fake DNS resolver injected into the delivery client.
