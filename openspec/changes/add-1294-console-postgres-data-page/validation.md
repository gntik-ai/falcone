# Validation

Local results in the maker sandbox (no network, no Chromium):

- `cd apps/web-console-next && node_modules/.bin/tsc --noEmit`: clean.
- `node scripts/lint-colours.mjs`, `node scripts/lint-i18n.mjs`, `node scripts/check-i18n.mjs`: pass.
- `node --test tests/check-i18n.test.mjs tests/lint-i18n.test.mjs`: 14 pass.
- `node tests/parity/validate.mjs`: pass; the new spec lists 48 tests (8 checks x es/en x 375/768/1280).
- `node_modules/.bin/vitest run` (normal mode, not fixture mode): 139 files passed, 1 skipped; 2676 tests passed, 3 skipped, 4 expected fail.
- `openspec validate add-1294-console-postgres-data-page --strict`: valid.
- `validate_page`: NOT_RUN. The gntik_ui MCP server is not available to this agent; the
  Hermes kit snapshot `e34e5d59...` was used. The colour lint finds no `bg-white`,
  `text-black`, `bg-black`, `text-white`, bracketed colour, `dark:` variant, inline colour,
  gradient or glow in the page sources.
- Browser parity, axe, CSP and viewport runs: not run here (Chromium unavailable). PR CI runs
  `pnpm --filter @in-falcone/web-console-next test:parity`. Screenshot assessment and baseline
  approval happen in the PR CI visual-review journey and at operator approval.

Legacy changes since the blueprint (`fecb3a03..2cb8214b`) only move imports to
`@in-falcone/console-api` (http, session, permissions, loaders, clients). They change no
behaviour, request, validation, state or copy, so nothing needs carrying over beyond using
the same console-api requests.
