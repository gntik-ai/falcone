# Falcone console next

The u0 scaffold runs alongside `apps/web-console`. It uses React 19, Tailwind 4 and
React Router 6, with placeholder pages matching the legacy console's route paths.

## Development and checks

Run these commands from the workspace root:

```sh
pnpm install --frozen-lockfile
node scripts/validate-gntik-ui-pin.mjs
pnpm --filter @in-falcone/web-console-next dev
pnpm --filter @in-falcone/web-console-next lint:colors
pnpm --filter @in-falcone/web-console-next typecheck
pnpm --filter @in-falcone/web-console-next test
pnpm --filter @in-falcone/web-console-next build
```

`VITE_BASE_PATH` defaults to `/next/`. Vite uses this value for asset URLs and
exposes it as `import.meta.env.BASE_URL`, which the browser router uses as its
basename. Set it to `/` for a root-hosted build:

```sh
VITE_BASE_PATH=/next/ pnpm --filter @in-falcone/web-console-next build
VITE_BASE_PATH=/ pnpm --filter @in-falcone/web-console-next build
```

Serve the SPA with a fallback to `index.html` beneath the configured base. This
scaffold adds no ingress or deployment configuration.

Tailwind runs through the app's own Vite plugin and CSS imports. Its inline
PostCSS configuration prevents loading the legacy Tailwind 3 setup. Use semantic
colour tokens such as `bg-background` and `text-foreground`; `lint:colors` rejects
hex colours and raw Tailwind palette classes in source and the HTML entry point.

The root uses the installed `falconePreset` (name and logo), `ThemeProvider` with
`defaultMode="dark"`, and `LiveAnnouncer`. The provider applies the `dark` class
to `<html>` and persists user theme choices under `falcone-next-theme`.

## Regression seams

Vitest renders the app root and browser router, including overview at both
`/next/console/overview` and `/console/overview`. The route-parity fixture was
extracted from the exported legacy `appRoutes` at base commit
`edfb9881736ed04a356f6d1b59e9245b3dafd55a`, using the default auth paths
`/login` and `/password-recovery`. Parent and child paths are joined, pathless
layouts add no path, index routes retain a trailing slash, and wildcards remain.
Update this fixture from the legacy export when later waves intentionally change
the route contract.

The repository's Node tests exercise the pin and colour CLIs with negative
fixtures. `tests/unit/web-console-next-build.test.mjs` invokes the installed
TypeScript and Vite CLIs, injects and removes a deliberate source type error,
checks asset URLs for both bases, and checks the new CI job's command coverage.

## Dependency integrity handoff

The following hashes are copied from `pnpm-lock.yaml` for the PR description.
The four direct dependencies have exact manifest pins. Other kit packages below
are transitive dependencies of the required templates and blocks; the scaffold
does not import their components. All use the default public npm registry.

| Package | Version | Integrity |
| --- | --- | --- |
| `@gntik-ai/blocks` | `0.5.0` | `sha512-U82KxZ/pch7DPEjHdCnJijTJaTcCt7Qmob47xskked00tT2dI63A3EjQHdfMCXpQIfPGqDY/NaU/pRf51nlK2Q==` |
| `@gntik-ai/charts` | `0.5.0` | `sha512-yTQpTfDK+MHLqce17o36xgLueQoWRQ4wz4abw/AwWBswTOXiB94pasuoGOOqV1jGVWfrliOAuMcqqd1IYoFbEA==` |
| `@gntik-ai/chat` | `0.5.0` | `sha512-zuy5BMSSVpudaCvwdQaXl6hRu2X+xB0N+JkZwiY0r+VjsY/2igS+Cbs+1rak5eAxH3A3W7bC8fbLdieI9MN3IA==` |
| `@gntik-ai/editor` | `0.5.0` | `sha512-xBW1oqDRskvdojCD+kS4vqorN8rL8Ch5akXSZh4q5dEdlUbnGIJxNEVquO6k36OeytS7m6Mm6duLSH7AMniz3g==` |
| `@gntik-ai/flow` | `0.5.0` | `sha512-kebbJ3/Tfnd4rnReQUkTVDSqBx8qjevEi1mDDbHDrgTR9he+xjjPaUt35+61hv3E4pMTKoMdOOeaE62nlMQETA==` |
| `@gntik-ai/icons` | `0.5.0` | `sha512-sj6o4hBsPMEipWUff8NMBgxVCt451gAPr6HoyPDNx8ZQQX8uIeWyRnYR7BlFdyRLVRyBWpPSbd2JKpjdkibB4g==` |
| `@gntik-ai/templates` | `0.5.0` | `sha512-/XvpKKOv4MYr6GVp2Ya8J8HKjAY3nFWQrM+J+QM99s6fkYngVtBXIz/mpljZ3RVLvhYLshFktdkJo6abtKFdcw==` |
| `@gntik-ai/tokens` | `0.2.1` | `sha512-Ys7tPnkMylielio3HIxQMTPp1tnmxnEqbp7JGnIaXdcdiAdZieudaLm2xnDCTZ+SWfq5AFTxmH0JQxIB+6CRSA==` |
| `@gntik-ai/ui` | `0.5.0` | `sha512-QAw3Yklf3txCdXSdPrPR/PJxoQlZZ9hoQ5R38DRIWD4Dmd62HVeRaMiG/tqwLysoONJ5Ku1KM3Ijje4wMTB06w==` |
