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
for base in / /next/; do
  SHELL_TEST_FIXTURES=true VITE_BASE_PATH="$base" pnpm --filter @in-falcone/web-console-next build
  VITE_BASE_PATH="$base" pnpm --filter @in-falcone/web-console-next test:parity
done
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
