## 1. Failing black-box test

- [x] 1.1 Add test `bbx-webhook-rebind` to `tests/blackbox/`: using a fake/injectable DNS resolver, register a subscription whose hostname first resolves to a non-blocked IP (subscription succeeds); then at delivery time inject a DNS response of `169.254.169.254` for the same hostname; trigger a delivery attempt and assert the delivery record status is `permanently_failed` with an SSRF-guard error detail and that no outbound HTTP connection was opened
- [x] 1.2 Add a companion positive test: delivery succeeds when the hostname re-resolves to the same non-blocked public IP at send time
- [x] 1.3 Add a redirect SSRF test: delivery worker follows an HTTP redirect but the redirect `Location` hostname resolves to a blocked IP; assert the attempt is `permanently_failed`
- [x] 1.4 Run `bash tests/blackbox/run.sh` and confirm `bbx-webhook-rebind` FAILS (red) before the fix is applied — note: if the delivery worker is absent from source, document this as a coverage gap and mark the test as pending/skipped with a TODO

## 2. Implement delivery-time re-resolution and IP pinning

- [x] 2.1 In the webhook delivery worker (wherever the HTTP client lives), import `isBlockedIp` from `services/webhook-engine/src/webhook-subscription.mjs`
- [x] 2.2 Before each outbound HTTP connection: call `dns.promises.lookup(hostname, { all: true })` to get all resolved IPs; iterate the results and call `isBlockedIp(address)` on each; if any result is blocked, skip the connection, set `delivery.status = 'permanently_failed'`, and write a delivery attempt record with `error_detail: 'ssrf_guard_rejected'`
- [x] 2.3 Pin the HTTP connection to the validated IP: pass the first non-blocked resolved address as the explicit `lookup` callback or `host` override in the HTTP agent so no second OS-level DNS resolution occurs at connect time
- [x] 2.4 Disable automatic HTTP redirect following OR add a redirect validator that re-resolves the `Location` header hostname and calls `isBlockedIp` before following; abort on blocked or non-HTTPS redirect targets

## 3. Verify

- [x] 3.1 Run `bash tests/blackbox/run.sh` and confirm `bbx-webhook-rebind` is green
- [x] 3.2 Confirm the positive delivery test is green
- [x] 3.3 Confirm the redirect SSRF test is green
- [x] 3.4 Run `bash tests/blackbox/run.sh`
