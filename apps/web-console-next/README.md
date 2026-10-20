# Falcone next console

Wave u0 provides a separate React 19 and Tailwind 4 console. Authenticated routes
share the kit shell, legacy-equivalent guards and tenant/workspace selection. Page
content remains placeholder content until its migration wave. Navigation links to
unmigrated pages load the legacy console in the same tab.
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
| @gntik-ai/blocks | 0.9.0 | sha512-jXLnEvpzqXItzRxgX1YnUmz2BGXRk65S7wqs/adVgEo/dIkmGkiKUQGcvteO1tEHN90dMJfQDRbImbV5+Yk0cA== |
| @gntik-ai/charts | 0.5.0 | sha512-yTQpTfDK+MHLqce17o36xgLueQoWRQ4wz4abw/AwWBswTOXiB94pasuoGOOqV1jGVWfrliOAuMcqqd1IYoFbEA== |
| @gntik-ai/chat | 0.9.0 | sha512-Wos3wq7GVgpkJ4eEnG3lVS0IZ5O4RaE16mm5U0WRXfyou+h2CX5CvwlFyUnPbTOJSakpkZoy+aPvGYI9jFRrHg== |
| @gntik-ai/editor | 0.5.0 | sha512-xBW1oqDRskvdojCD+kS4vqorN8rL8Ch5akXSZh4q5dEdlUbnGIJxNEVquO6k36OeytS7m6Mm6duLSH7AMniz3g== |
| @gntik-ai/flow | 0.5.0 | sha512-kebbJ3/Tfnd4rnReQUkTVDSqBx8qjevEi1mDDbHDrgTR9he+xjjPaUt35+61hv3E4pMTKoMdOOeaE62nlMQETA== |
| @gntik-ai/icons | 0.5.0 | sha512-sj6o4hBsPMEipWUff8NMBgxVCt451gAPr6HoyPDNx8ZQQX8uIeWyRnYR7BlFdyRLVRyBWpPSbd2JKpjdkibB4g== |
| @gntik-ai/templates | 0.9.0 | sha512-YW4t4WAITWFqDVmjOn2VNhkbpD/wnNkG5WieUoKU0bJKcF3TTUOzzjofOYWnUoLB4UhOIHTNaK/NhTjkgpjVkg== |
| @gntik-ai/tokens | 0.2.1 | sha512-Ys7tPnkMylielio3HIxQMTPp1tnmxnEqbp7JGnIaXdcdiAdZieudaLm2xnDCTZ+SWfq5AFTxmH0JQxIB+6CRSA== |
| @gntik-ai/ui | 0.9.0 | sha512-GCwMcbKnB/dV9kk9DY7tJCP7OtryTFZrePVHKAcj6cVctni/XqmVmYNoeEPRoG2iskr84H0WAraD2hkPeDUUfQ== |

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

## Internationalization (wave u0)

Spanish (`es`) is the first-load default, even in an English browser. The header
user menu and `/console/settings` share a native, labelled language select.
English (`en`) is the other supported locale. `falcone-next-locale` in localStorage
stores the preference; invalid or unavailable storage falls back safely to Spanish.
Switching changes `<html lang>` and React copy without navigation. This preference
is client-only; storing it on a user profile belongs to a later wave.

`src/i18n/index.ts` initializes i18next/react-i18next with ICU and no HTTP backend.
Common resources live in `src/locales/{es,en}/common.json`. Each lazy page imports
its two local JSON files and registers its namespace through `placeholderPage`.
The generic pending routes share the pendingPage chunk; migrated pages should get
their own lazy module and namespace. Keep descriptive keys stable and use
`useTranslation('namespace')` with `t('key')`, including all accessible labels.
Do not import page resources into the entry or common module. `StatusPage` supplies
loading, empty, unauthorized (401), forbidden (403), not-found (404), server-error
(500) and network copy and localized live announcements for migrated routes.

Use `src/i18n/format.ts` for Intl dates, numbers and relative times; it reads the
active locale on every call. React consumers must subscribe with `useTranslation`
so formatting re-renders on switches. Kit 0.9.0 built-in labels follow the shell's
`I18nProvider`, which receives the active app locale. The mounted breadcrumb
landmark is labelled `Ruta de navegación` by default and `Breadcrumb` after
switching to English; the locale unit and browser tests assert both labels.
Explicit kit label props override the catalog, so use translated app resources
when supplying them. Common provides pagination summaries (ICU plural), filter
controls and saved-view fallbacks for future page compositions.

Additional checks:

```sh
pnpm check:i18n
pnpm lint:i18n
pnpm test:i18n
pnpm build
pnpm test:i18n-chunks
```

Run these from this package, or use the workspace filter. `check:i18n` accepts a
locale root followed by source file/directory paths, defaulting to `src/locales`
and `src`. It compares nested leaf keys in both directions and checks literal
namespace declarations in lazyPage, placeholderPage and useTranslation calls.
`lint:i18n` accepts file/directory arguments and parses JSX with the existing
TypeScript toolchain. It rejects text nodes, literal text expressions and literal
aria-label/title/placeholder attributes; class names, test IDs, comments and
ordinary code strings are allowed. No ESLint or remote translation service is used.

CI runs negative fixtures for both CLIs and checks the Vite manifest's static
entry graph after each base-path build. The Vitest harness checks the shell and
all seven statuses against explicit Spanish/English copy, including accessible
labels and live regions. The existing CSP Playwright suite additionally checks
switching and reload persistence with an English browser locale, corrupt storage,
formatted samples and exclusively local requests at both base paths.

## Authenticated shell

The session provider delegates storage, refresh, retry and invalidation to
`@in-falcone/console-api/session`; sign-out delegates revocation to `/auth`.
Both consoles keep sharing the existing session keys and the active-context
snapshot `{userId, tenantId, workspaceId, updatedAt}`. Only a workspace route
parameter overrides the stored context. Platform-global routes hide context
controls. The kit I18nProvider follows the app locale, including built-in labels.

Run shell browser checks against a fixture build (synthetic sessions only):

```sh
SHELL_TEST_FIXTURES=true VITE_BASE_PATH=/next/ VITE_APP_VERSION=1.2.3 VITE_APP_COMMIT_SHA=0123456789abcdef0123456789abcdef01234567 pnpm --filter @in-falcone/web-console-next build
VITE_BASE_PATH=/next/ pnpm --filter @in-falcone/web-console-next exec playwright test --config tests/shell/playwright.config.mjs
```

The spec checks each lazy navigation mechanism from a fresh document, render
error containment, About, and axe at 375/768/1280 pixels and in the mobile drawer.
`SHELL_TEST_FIXTURES` must be unset or empty in release builds. CI first checks a
release build with `tests/shell-release.test.mjs`, then builds the fixture variant;
the existing final release build also leaves fixtures disabled. For the focused
Vitest fixture checks, set `SHELL_TEST_FIXTURES=true` and run
`vitest run tests/shell-fixtures.test.tsx` from this package.
