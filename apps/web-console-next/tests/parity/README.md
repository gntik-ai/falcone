The overview companion spec is the eight-check template. Add a typed
`pages/<page>.manifest.ts` and copy its companion spec for each migration.
Selectors are public DOM locators; use locale maps for translated text. Actions
list clicks, the exact HTTP request (including body), and the visible outcome.
States declare an endpoint fixture, variant and visible state locator. Declare
all source files/directories used by the page for colour lint.

Run from the workspace root:

```sh
pnpm --filter @in-falcone/web-console-next parity:scan
pnpm --filter @in-falcone/web-console-next parity:validate
SHELL_TEST_FIXTURES=true VITE_BASE_PATH=/ pnpm --filter @in-falcone/web-console-next build
VITE_BASE_PATH=/ pnpm --filter @in-falcone/web-console-next test:parity
```

`test:parity` first runs the shell under three roles and two locales, then runs
an isolated suite whose seeded faults must fail with specific diagnostics.
`negative.spec.mjs` is excluded from the normal config. The negative verifier
rejects missing tests, infrastructure failures and missing traces. Inspect both
positive and negative HTML/JSON reports and traces under `test-results/parity/`.
Only complete all-passed groups get `PARITY_PASS` in per-page JSON. In CI, use
the merged `ui-parity-report` artifact as the certification source: its HTML,
`results.json` and per-page JSON cover all 32 shards, including groups split
between shards. It also includes every shard's reports, blobs and retained traces.
The aggregate checks the merged test identities and count against an unsharded
`--list`, with no duplicates, retries or skipped tests. Per-shard artifacts
`ui-parity-shard-<n>` remain available for seven days; their incomplete groups
cannot certify a page. A filtered run cannot certify a page either.
Screenshots are recorded and compared within each
visual check under the ignored output directory, with a fresh navigation before
the comparison; no baseline is committed.
The clock is fixed and randomness is seeded before any application script.

CI uses two workers per shard; local runs keep one worker and zero retries.
The CI run with three workers failed loading checks in console operations.
Two workers leave CPU headroom for each browser; 32 shards compensate for the
lower concurrency within a runner without filtering or retrying any tests.
PR CI must confirm the browser failures are resolved and measure the wall time,
including runner queue time; local discovery cannot establish either outcome.
The worker-scoped servers use ephemeral ports and isolated temporary directories;
reporters write once in the main process. Blob reports include the same synthetic
results and attachments as the existing reports, plus test execution metadata.
Merging replays those results without browser requests or additional fixtures.
The job summary records each shard's test duration and the merged test count.
Record setup, aggregate and total stage durations from the CI job timestamps in
the PR description, along with the count compared to main. The initial timeouts
(structure 10 min, shards 25 min, negatives 15 min, aggregate 10 min) are budgets
to validate against that run, not measured performance claims. The shard budget
includes setup margin over an estimated 8.5-minute slowest test run after
quadrupling the old eight shards and using two workers (previous maximum:
68 minutes). This estimate assumes even distribution and available runners;
32 runner setups can increase total runner-minutes and queue time.

The scanner accepts explicit file/directory paths, including temporary files.
With no arguments it scans this suite's fixtures and the console-api builders.
It prints only the file, line and rule, never the matching credential text.

The suite uses only the local ephemeral server and synthetic fixtures. Every
unmatched request fails during automatic teardown even if a test never asserts
a request list. Route misses still return the APISIX 404 body. Expected error
variants are exercised by the state/endpoint checks; runtime-health examines
the clean success path so those deliberate HTTP errors cannot mask real errors.

Known localisation gap: the kit's empty workspace trigger displays English
`Select workspace` in es. The empty-state assertion checks the absence of a
selected workspace without requiring that English copy. Locale checks cover
the success shell; extending them to all variants needs a kit localisation fix
in a follow-up, outside this harness change.

CI initially reports an optional check. Before removing this job after making
it required, the operator must first remove its branch-protection requirement.

Page manifests may opt into `workspace_admin` and `workspace_viewer` in `roles`;
the default shell matrix stays unchanged. To register page endpoints, add a typed
`endpoints` map to the manifest and set this in the companion spec before its tests:

```js
test.use({ pageEndpoints: manifest.endpoints ?? {} });
```

Each map entry has `method`, an absolute `/v1/...` `path`, and a `fixtures` map.
A fixture is `{ status, body, network?, delayMs? }` or a function from role to
that response. Provide `success` and any page-specific fixtures such as `empty`.
Page endpoints also support the standard `401`, `403`, `404`, `500` and `network`
variants. Shell and page endpoints share one registry. Duplicate names and
duplicate method/path pairs are rejected, including collisions between pages.
Unregistered API calls and external calls still fail automatic teardown.

`parity.open(route, variants)` and `parity.network.setVariants(variants)` accept
strings as before, `{ variant: 'success', delayMs: 1000 }` for a delayed response,
and arrays such as `['500', 'success']` for a retry scenario. Each endpoint
advances independently and repeats its final response. Opening a page or setting
variants resets sequence counters; an unknown endpoint/fixture is an error.
Responses can also specify `delayMs` directly in the fixture.

`parity.open` waits for the shell and lazy page to settle. To observe a page's
initial loading state, configure variants first and navigate with
`parity.page.goto(...)` directly, or trigger the request after `open`.
`fixtures/page.ts` and the page-endpoint cases in `harness.spec.mjs` demonstrate
registration for both workspace roles, loading before data, and error then retry.
The negative suite also verifies that page registration keeps unmatched requests
fatal. No synthetic page route is shipped in the application.

Operation detail registers three reads on the same POST path using disjoint flat
`requestBody: { queryType: 'detail' | 'logs' | 'result' }` discriminators. A request
must match its body as well as its method/path. Registrations without a body
remain path-only; duplicate or overlapping registrations still throw. Fixture
callbacks also receive the request body (for server pagination), and a fixture
may be a nonempty array of responses or callbacks, repeating its final entry
after retries. A recovery callback receives each new request body, so subsequent
log pages still honor the requested offset.

Only injected operation-query 500/network responses authorize a corresponding
browser resource diagnostic, once, at that exact URL. Application console errors,
page errors and unhandled rejections remain faults. The operation companion
covers positive recovery and seeded console-error/rejection negatives at each
viewport and locale. Its visual check attaches screenshots named with SHA256;
these are review artifacts, not self-comparison or operator approval.

## Kit sample data (G1/G2)

The kit `DataTable` renders built-in sample deployments when it gets no `rows`. Two guards keep them out of the console:

- Runtime: `assertNoSampleData` (checks.mjs) fails a journey when a settled page shows a string from
  `kit-sample-strings.json` that no mocked response or typed input supplied. The harness runs it after `open()`, after every
  action (`click`, `fill`, `press`, ...) and every awaited `expect` matcher imported from `harness.mjs`, after each check in
  `checks.mjs`, and once before teardown. Regenerate the strings with
  `node scripts/extract-kit-sample-strings.mjs --write` (downloads the pinned `@gntik-ai/blocks` tarball, verifies the
  integrity recorded in `pnpm-lock.yaml`); `--check` fails unless the committed file is byte-identical.
- Static: `parity:validate` applies `parity/no-implicit-sample-data` to `src` (see `sample-data-rule.mjs`). A kit
  `DataTable` passes only with a `rows` attribute after every spread, or with spreads of top-level `const` object
  literals that have a literal `rows` key and are referenced nowhere else except as JSX spreads.
