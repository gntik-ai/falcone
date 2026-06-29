## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `17ec4af5`): bare native form controls in the
  console (`ConsolePostgresDataPage`, `ConsoleMongoDataPage`, `RealtimeConsole`,
  `EventsConsole`, `FunctionsConsole`) carry no `className`. Tailwind preflight sets
  `color: inherit` (→ near-white `--foreground`) but `background-color: transparent` only on
  button-type inputs, so text inputs/selects/textareas keep the UA-white background →
  near-white-on-white (~1.02:1, below WCAG AA 4.5:1).
- [x] 1.2 Add regression test
  `apps/web-console/src/pages/form-control-legibility.test.tsx`:
  - Render each affected page/component (data pages need a console context with
    `activeWorkspaceId`; `EventsConsole`/`FunctionsConsole` need their list API mocked;
    `RealtimeConsole` needs the realtime API mocked).
  - Locate each control by its production `id` and assert `className` matches
    `/bg-background/` (and `/text-foreground/` for inputs).
  - On `main`: bare control → empty className → no match → FAIL (RED).
  - On this branch: primitive → className includes `bg-background` → PASS (GREEN).

## 2. Fix

- [x] 2.1 `ConsolePostgresDataPage.tsx`: `<input>` → `<Input>`, `<label>` → `<Label>` for
  `pg-db`/`pg-schema`/`pg-table`; preserve all props.
- [x] 2.2 `ConsoleMongoDataPage.tsx`: same for `mongo-db`/`mongo-collection`.
- [x] 2.3 `RealtimeConsole.tsx`: `<select>` → `<Select>` for `rt-source`; `<input>` →
  `<Input>` for `rt-db`/`rt-collection`/`rt-schema`/`rt-table`/`rt-key`; `<label>` →
  `<Label>`. `<option>` children of `<Select>` are unchanged.
- [x] 2.4 `EventsConsole.tsx`: `<input>` → `<Input>` for `new-topic`; `<textarea>` →
  `<Textarea>` for `message-json`; `<label>` → `<Label>`. The `type="radio"` topic selectors
  remain native (covered by the safety-net rule).
- [x] 2.5 `FunctionsConsole.tsx`: `<textarea>` → `<Textarea>` for `deploy-spec-json` and
  `input-json`; `<label>` → `<Label>`. The `type="radio"` function selectors remain native.
- [x] 2.6 `styles/globals.css`: add the `input, textarea, select { @apply bg-background
  text-foreground }` base-layer safety net, with a comment explaining the root cause and why
  it cannot regress already-styled controls.
- [x] 2.7 Leave the plan-catalog status filter (`ConsolePlanCatalogPage.tsx`, already fixed by
  #747/#814) byte-identical.
- [x] 2.8 Bounded design pass on the affected form regions (step 5b): a UX pass (field grouping,
  responsive grids, card-style page headers, design-system `Button` swaps, legible
  `role="alert"`/`role="status"` feedback) and a UI visual-polish pass (unify the field-grid
  vertical rhythm), both reusing the existing design system and preserving every control `id`,
  `htmlFor`↔`id` pairing, `role`, button accessible name, and the asserted
  `bg-background`/`text-foreground` classes. The full data-editor/list/result redesign is
  deferred to the dedicated issues #757 (data-plane design system) and #789 (Functions UX/UI).

## 3. Wire / contract / docs

- [x] 3.1 No OpenAPI/contract/SDK change — frontend-only styling fix; no `*.openapi.json`,
  generated types, `internal-contracts`, `public-route-catalog.json`, or gateway config edited.
- [x] 3.2 Docs: add `docs/reference/architecture/console-form-control-theming.md` documenting
  that console form controls must use the design-system `Input`/`Select`/`Textarea` primitives
  (or rely on the globals.css base rule) so they get a theme-correct dark background, and
  explaining the Tailwind-preflight root cause.
- [x] 3.3 Spec delta:
  `openspec/changes/fix-806-form-control-legibility/specs/web-console/spec.md` — `## ADDED
  Requirements` (NOT MODIFIED) under the `web-console` capability, one requirement with two
  WHEN/THEN scenarios matching the acceptance criteria (data-plane editors + realtime form).

## 4. Verify

- [ ] 4.1 CI runs `pnpm --filter @in-falcone/web-console test` (the `web-console` CI job
  executes vitest) — the new test is the executed regression gate. Local vitest execution is
  gated in this environment; CI is the authoritative check.
- [x] 4.2 Confirm `git diff --name-only origin/main...HEAD` touches only files under
  `apps/web-console/src/`, `docs/`, and `openspec/changes/fix-806-form-control-legibility/`
  (force-added past `.gitignore`). Confirmed by the independent post-fix checker (11 files, no
  contract/SDK/openapi/route-catalog artifacts → codegen no-diff).
- [ ] 4.3 `openspec validate fix-806-form-control-legibility --strict` (if the CLI is
  available).
