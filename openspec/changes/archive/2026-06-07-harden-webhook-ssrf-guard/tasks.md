## 1. Blocklist extension

- [x] 1.1 Add `169.254.0.0/16` check to `services/webhook-engine/src/webhook-subscription.mjs::isPrivateHostname:9-17`
- [x] 1.2 Add `0.0.0.0` / `0.0.0.0/8` check to `isPrivateHostname`
- [x] 1.3 Add `::` (IPv6 unspecified) and `::ffff:169.254.0.0/112` (IPv4-mapped link-local) checks to `isPrivateHostname`
- [x] 1.4 Add numeric IP normalization (decimal, octal, hex) to canonical dotted-decimal before range checks in `isPrivateHostname`

## 2. DNS resolution at registration

- [x] 2.1 In `services/webhook-engine/src/webhook-subscription.mjs::validateSubscriptionInput:19-39`, add async DNS resolution for non-IP hostnames
- [x] 2.2 Check every resolved IP against the complete blocklist; return `INVALID_URL` if any resolved IP is blocked
- [x] 2.3 Return `INVALID_URL` if DNS resolution fails (fail-closed)

## 3. Delivery-time re-validation

- [x] 3.1 Identify the outbound HTTP delivery component (outside `webhook-engine/src`)
- [x] 3.2 Add delivery-time DNS re-resolution and blocklist re-validation of all resolved IPs
- [x] 3.3 Abort delivery and record permanent failure if re-resolution yields a blocked address (DNS-rebinding defense)

## 4. Verification

- [x] 4.1 Add black-box test `bbx-webhook-ssrf-01`: `https://169.254.169.254/` at subscription creation returns `INVALID_URL`
- [x] 4.2 Add black-box test `bbx-webhook-ssrf-02`: decimal-encoded `https://2852039166/` returns `INVALID_URL`
- [x] 4.3 Add black-box test `bbx-webhook-ssrf-03`: `https://0.0.0.0/` returns `INVALID_URL`
- [x] 4.4 Add black-box test: DNS name resolving to `169.254.169.254` returns `INVALID_URL`
- [x] 4.5 Add black-box test: legitimate public HTTPS URL is accepted
- [x] 4.6 Run `bash tests/blackbox/run.sh`
