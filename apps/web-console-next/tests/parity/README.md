The overview companion spec is the eight-check template. Add a typed
`pages/<page>.manifest.ts` and copy its companion spec for each migration.
Selectors are public DOM locators; use locale maps for translated text. Actions
list clicks, the exact HTTP request (including body), and the visible outcome.
States declare an endpoint fixture, variant and visible state locator. Declare
all source files/directories used by the page for colour lint.

Run from the workspace root:

```sh
SHELL_TEST_FIXTURES=true VITE_BASE_PATH=/ pnpm --filter @in-falcone/web-console-next build
pnpm --filter @in-falcone/web-console-next parity:scan
pnpm --filter @in-falcone/web-console-next parity:validate
pnpm --filter @in-falcone/web-console-next test:parity
```

`test:parity` first runs the shell under three roles and two locales, then runs
an isolated suite whose seeded faults must fail with specific diagnostics.
`negative.spec.mjs` is excluded from the normal config. The negative verifier
rejects missing tests, infrastructure failures and missing traces. Inspect both
positive and negative HTML/JSON reports and traces under `test-results/parity/`.
Only complete all-passed groups get `PARITY_PASS` in per-page JSON. A filtered
run cannot certify a page. Screenshots are recorded and compared within each
visual check under the ignored output directory, with a fresh navigation before
the comparison; no baseline is committed.
The clock is fixed and randomness is seeded before any application script.

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

## Page endpoints and response scenarios

A page manifest can declare optional `endpoints`, keyed by fixture name. Each
entry has `method`, a root-relative API `path`, and `fixtures: { success, empty? }`
containing synthetic response bodies. Register them once per test before opening
the page, including tests using the eight-check helpers:

```js
test.beforeEach(async ({ parity }) => {
  parity.network.registerEndpoints(manifest.endpoints ?? {});
});
```

Shell endpoints remain available. Duplicate names or method/path pairs are
rejected. Registration is local to the test and never makes unknown requests
valid; the unmatched-request negative control registers a page fixture before
issuing an unknown request. External requests, including `/v1/` requests, are
aborted and fail teardown.

`workspace_admin` and `workspace_viewer` are opt-in through each page manifest's
`roles`; the existing shell matrix remains unchanged. `fixtures/page.ts` and
`page-endpoints.spec.mjs` exercise these roles without migrating a page.

Existing string variants still work. Each selected endpoint also accepts an
object with optional `variant`, `delayMs`, and `sequence`, for example:

```js
await parity.open(manifest.route, {
  page: { delayMs: 2000, sequence: ['500', 'success'] },
}, { waitForReady: false });
```

The delay applies to every response. A sequence advances per matched request,
then repeats its final response; opening a page or calling `setVariants` resets
the sequence. Numeric HTTP variants return synthetic error envelopes and
`network` aborts the request. These options also work for shell endpoints.
`open` waits for readiness by default. Set `waitForReady: false` to observe the
loading DOM before the delayed response, then assert the error, click the page's
retry button and assert the data through public DOM locators.
