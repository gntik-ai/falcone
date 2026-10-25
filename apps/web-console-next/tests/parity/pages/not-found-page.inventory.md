The legacy catch-all is `apps/web-console/src/router.tsx:221-223` and its
seven unit tests in `src/pages/NotFoundPage.test.tsx` are covered for es and en
by `tests/notFound.test.tsx`, including the public route title check from
`src/router.auth-layout-wiring.test.tsx:30`.

The legacy E2E inventory at delivery base `102d4e18c29e2f86df2e24b2d7c811b0db49a0c3` is:

| File under apps/web-console/e2e | Test declarations | Calls to test.fixme | Catch-all assertions |
| --- | ---: | ---: | ---: |
| console-auth-flows.e2e.ts | 3 | 0 | 0 |
| console-context-auth-e2e.e2e.ts | 21 | 3 | 0 |
| console-service-e2e.e2e.ts | 17 | 0 | 0 |
| workspace-docs.spec.ts | 1 | 0 | 0 |
| Total | 42 | 3 | 0 |

These files exercise authentication, tenant context, services and workspace
documentation. Their journeys belong to those page migrations. The new
`not-found-page.spec.mjs` supplies catch-all coverage with the shared synthetic
session fixtures, es/en, and 375/768/1280 px viewports.

The anonymous fixture removes the harness session seed. The stored-valid
fixture uses `sessionFor`, and the expired variant changes only its expiry.
Chunk interception covers skeleton loading and failed/offline chunk boundaries.
Recovery after a failed lazy import is excluded by the operator amendment:
React.lazy caches the rejection. No committed screenshot baseline is added;
the three required visual states produce SHA256-named attachments for checker
assessment and operator approval before merge.
