## 1. Black-box tests (write before fix)

- [x] 1.1 Author black-box test scenario A: service startup fails with explicit error when `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=production` (must fail against unfixed code)
- [x] 1.2 Author black-box test scenario B: dev-mode bypass returns non-empty `subscriptionContext` with a `tenantId` field (must fail against unfixed code)
- [x] 1.3 Author black-box test scenario C: no subscription is allowed with tenant-less empty context in any environment (must fail against unfixed code)
- [x] 1.4 Author black-box test scenario D: normal auth path with `REALTIME_AUTH_ENABLED=true` is unmodified (must pass before and after fix)

## 2. Startup-time production guard

- [x] 2.1 In `services/realtime-gateway/src/config/env.mjs:68-72`, add assertion: if `REALTIME_AUTH_ENABLED=false` and `NODE_ENV=production`, throw a descriptive configuration error before the event-loop opens listeners

## 3. Bypass block removal or strict gating

- [x] 3.1 In `services/realtime-gateway/src/actions/validate-subscription-auth.mjs:34-37`, remove the blanket bypass block or replace it with a strict guard: `NODE_ENV !== 'production'` AND a non-empty dev-tenant `subscriptionContext` (never `{}`)
- [x] 3.2 Confirm that the normal auth path (all guards from line 43 onward) remains entirely unmodified when `REALTIME_AUTH_ENABLED=true`

## 4. Verification

- [x] 4.1 Run `bash tests/blackbox/run.sh` and confirm scenarios A–C pass and all existing tests (including scenario D) are unaffected
