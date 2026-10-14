# Falcone next console

Wave u0 provides a separate React 19 and Tailwind 4 scaffold. All routes render
placeholders; no page migrations, authentication wiring or deployment are included.
The router test reads the legacy exported `appRoutes` configuration with the
TypeScript parser, comparing full paths without loading the legacy React app.

## Local checks

```sh
pnpm --filter @in-falcone/web-console-next typecheck
pnpm --filter @in-falcone/web-console-next test
pnpm --filter @in-falcone/web-console-next lint:colours
node scripts/validate-gntik-ui-pin.mjs
VITE_BASE_PATH=/next/ pnpm --filter @in-falcone/web-console-next build
```

`VITE_BASE_PATH` defaults to `/`. Set it to `/next/` for side-by-side development;
it configures both Vite asset URLs and the router basename. Tailwind's Vite plugin
and stylesheet configuration are local to this package.

The colour lint scans `src` and `index.html` by default. It also accepts file or
directory arguments for fixtures and rejects hex colours and palette utilities.
Use the UI kit's semantic tokens. The pin validator accepts an optional repository
root argument, used by its temporary-manifest tests. It checks exact manifest and
lockfile importer pins, strips peer suffixes from versions, and rejects explicit
kit tarballs outside the public npm registry. CI runs it without adding it to
`validate:repo`. UI page validation is deferred to page migration waves.

## Integrity hashes for the PR description

These hashes come from the platform-generated `pnpm-lock.yaml`. All entries use
the default public npm registry. The templates package brings additional kit
packages transitively; the scaffold directly pins only ui, blocks, templates and
tokens and imports no page components from those transitive packages.

| Package | Version | Integrity |
| --- | --- | --- |
| @gntik-ai/blocks | 0.5.0 | sha512-U82KxZ/pch7DPEjHdCnJijTJaTcCt7Qmob47xskked00tT2dI63A3EjQHdfMCXpQIfPGqDY/NaU/pRf51nlK2Q== |
| @gntik-ai/charts | 0.5.0 | sha512-yTQpTfDK+MHLqce17o36xgLueQoWRQ4wz4abw/AwWBswTOXiB94pasuoGOOqV1jGVWfrliOAuMcqqd1IYoFbEA== |
| @gntik-ai/chat | 0.5.0 | sha512-zuy5BMSSVpudaCvwdQaXl6hRu2X+xB0N+JkZwiY0r+VjsY/2igS+Cbs+1rak5eAxH3A3W7bC8fbLdieI9MN3IA== |
| @gntik-ai/editor | 0.5.0 | sha512-xBW1oqDRskvdojCD+kS4vqorN8rL8Ch5akXSZh4q5dEdlUbnGIJxNEVquO6k36OeytS7m6Mm6duLSH7AMniz3g== |
| @gntik-ai/flow | 0.5.0 | sha512-kebbJ3/Tfnd4rnReQUkTVDSqBx8qjevEi1mDDbHDrgTR9he+xjjPaUt35+61hv3E4pMTKoMdOOeaE62nlMQETA== |
| @gntik-ai/icons | 0.5.0 | sha512-sj6o4hBsPMEipWUff8NMBgxVCt451gAPr6HoyPDNx8ZQQX8uIeWyRnYR7BlFdyRLVRyBWpPSbd2JKpjdkibB4g== |
| @gntik-ai/templates | 0.5.0 | sha512-/XvpKKOv4MYr6GVp2Ya8J8HKjAY3nFWQrM+J+QM99s6fkYngVtBXIz/mpljZ3RVLvhYLshFktdkJo6abtKFdcw== |
| @gntik-ai/tokens | 0.2.1 | sha512-Ys7tPnkMylielio3HIxQMTPp1tnmxnEqbp7JGnIaXdcdiAdZieudaLm2xnDCTZ+SWfq5AFTxmH0JQxIB+6CRSA== |
| @gntik-ai/ui | 0.5.0 | sha512-QAw3Yklf3txCdXSdPrPR/PJxoQlZZ9hoQ5R38DRIWD4Dmd62HVeRaMiG/tqwLysoONJ5Ku1KM3Ijje4wMTB06w== |

CSP asset checks use the unchanged headers parsed from `../web-console/static-server.mjs`.
The body font is Geist Sans; the test page's `code[data-testid="mono"]` uses Geist Mono.
Run `pnpm test:dist` for the validator fixtures. To exercise Chromium locally:

```sh
pnpm exec playwright install --with-deps chromium
for base in / /next/; do
  CSP_TEST_HARNESS=true VITE_BASE_PATH="$base" pnpm build
  pnpm validate:dist
  VITE_BASE_PATH="$base" pnpm test:csp
done
```

The separate `tests/csp/index.html` entry derives concrete paths from `appRoutes`,
mounts Monaco (editor and YAML workers) and xyflow, and includes an inline-script
negative control served from a temporary dist copy. It is included only when
`CSP_TEST_HARNESS=true`; ordinary builds do not ship this page or its editor bundles.

Use `configureLocalMonacoYaml` from `src/lib/monaco-environment.ts` for YAML
surfaces. `monaco-worker-manager` 2.x passes the older `moduleId`/`createData`
options; Monaco 0.54 requires an explicit `worker`. The adapter constructs the
bundled YAML worker, sends its bootstrap and language settings before Monaco's
RPC messages, and leaves the shared Monaco API unchanged. The CSP harness checks
actual YAML diagnostics and diff results, and rejects worker fallback warnings
and uncaught page errors.
