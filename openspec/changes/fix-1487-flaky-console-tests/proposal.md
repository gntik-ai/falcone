# Wait for the async state asserted by six console tests

## Why

Issue #1487 reports intermittent failures when tests observe a heading or URL before the associated lazy chunk, request, focus effect or toast entry has completed. The assigned source worktree is clean at entry on branch `agent/falcone/1487/96a111a3-e3c6-5031-8c47-2cf39896b941`; this is an R1 source-only change.

The legacy SignupPage case is reproducible through its rendered AuthLayout and the fetch boundary. Holding the policy response until after the heading appears makes the original synchronous username query fail with `Unable to find a label with the text of: /usuario/i`. The command is `cd apps/web-console && node node_modules/vitest/vitest.mjs run src/pages/SignupPage.test.tsx -t '#731' --pool=threads --configLoader=runner`. Replacing that query with `findByLabelText` passes the same controlled response. The deferred response remains in the regression test so a fast policy response cannot hide the ordering mistake.

The initial unmodified next-console files and legacy signup file passed locally. During repeated validation, allocation failed on run 9: the pending retry button disappeared and the initial skeleton returned. A minimized DOM-observer regression clicks the first rendered retry control before passive effects run, while holding the next response at the fetch boundary. It failed twice with a missing Reintentando button and the loading skeleton. Reproduction: `cd apps/web-console-next && node node_modules/vitest/vitest.mjs run tests/consoleTenantAllocationSummary.test.tsx -t 'retry started as' --pool=threads --configLoader=runner`.

The diagnostic alternatives were: (1) a preceding render's focus effect consumes the newly requested retry flag, predicting that guarding focus while a request is in flight preserves the pending control; (2) a premature click is ignored by the request guard, predicting no second request; (3) a locale mismatch, predicting a retry button with a different name rather than a skeleton. The deterministic reproduction and passing regression after the in-flight focus guard confirm the first cause. The focus effect now leaves the new retry flag alone until the request completes. No markup or copy changes are needed. The other four next-console timing reports were not independently reproduced in this sandbox; their changes remain test synchronization only.

## Changes and public seams

| Test | Async condition now awaited | Page change |
| --- | --- | --- |
| Operations unmount | After the detail URL, advance the paused clock by 300 ms before checking the mounted detail. This stays below the 500 ms debounce; all three stages retain exact traffic and abort assertions. | None |
| Pending catch-all | Find the main landmark, wait for its loading ID, then find its loading status before waiting for final heading focus. Repeated runs also reproduced the heading rendering before its focus effect. A missing skeleton still fails. | None |
| Tenant allocation retry, es and en | Wait for each individual focus assertion: pending retry, failed retry, recovered h1. Add a deterministic earliest-click regression through the rendered control. | Guard the focus effect while a request is in flight so it cannot consume a later retry's flag. |
| Quotas error-empty | Keep each declared state locator before counts, request ID and links; wait for the organization table in the no-workspaces case and the error request ID before retrying. The recovered table count remains two. Keep the shared open helper unchanged so the 401 case can redirect to login without waiting for the quotas surface. | None |
| Signup accessibility | Wait for the success notification dialog's computed opacity to reach 1 before the final full-page axe call. | None |
| Legacy SignupPage #731 | Release the policy response after the layout heading and await the username label. | None |

The installed `@gntik-ai/ui` 0.11.0 toast root includes `motion-reduce:transition-none`. Signup uses this root without overriding its motion classes, so no page motion fix is needed. The browser test still waits for computed opacity rather than assuming that the media preference alone has settled entry. It excludes no content from axe.

No sleeps, test timing configuration changes, retries, worker configuration changes, shared parity harness changes, dependencies or deployment changes are included. The allocation focus guard is the only application source change.

## Validation and handoff

The test inventory and final results are recorded in tasks.md. Browser repetitions across every existing role/locale/viewport combination, browser stress and the long-transition negative check require PR CI with Chromium. The independent checker retains visual assessment and operator approval of parity screenshots. No screenshots or browser success are claimed from this sandbox.
