## Why

The shared `DestructiveConfirmationDialog` (`apps/web-console/src/components/console/DestructiveConfirmationDialog.tsx:139-142`)
runs the destructive op's **success side effects regardless of whether the op actually
succeeded**. Its confirm button did:

```ts
onClick={async () => {
  await Promise.resolve(onConfirm())
  config.onSuccess?.()
}}
```

The two real callers pass `onConfirm={() => void destructiveOp.handleConfirm()}`
(`ConsoleServiceAccountsPage.tsx:192`, `ConsoleAuthPage.tsx:828`). The `void` makes
`onConfirm()` return `undefined`, so `await Promise.resolve(undefined)` settles on the very
next microtask — **before** the real backend op (awaited inside `useDestructiveOp.handleConfirm`)
resolves — and `config.onSuccess?.()` fires **unconditionally**.

The hook `apps/web-console/src/components/console/hooks/useDestructiveOp.ts:98-113` already owns
the op lifecycle correctly: it `await`s `config.onConfirm()`, fires `config.onSuccess` **once on
success only** (line 108), and on failure sets `confirmError` + `opState='error'` with **no**
`onSuccess`. The dialog therefore **duplicated** the hook:

- On success, `onSuccess` fired twice → a double list reload.
- On failure (including a credential **revoke** that errors with 404/500), the dialog's immediate
  `onSuccess` showed false "success" feedback — misleading an operator into believing a
  security-relevant op succeeded when it did not (a contradictory success + error state, since the
  hook still surfaced the error).

## What Changes

- **Make the dialog purely presentational; the hook owns the lifecycle.** In
  `DestructiveConfirmationDialog.tsx`, the destructive confirm button's `onClick` becomes simply
  `onClick={() => onConfirm()}`. The `await Promise.resolve(onConfirm())` and the
  `config.onSuccess?.()` line are removed. `onConfirm` (the hook's `handleConfirm`) owns awaiting
  the op, running success side effects (once, only on success), and surfacing errors
  (`confirmError`/`opState`, already passed in as props and rendered). `config` is still used by
  the dialog for rendering (`resourceName`/cascade/level/etc.) — only the `config.onSuccess?.()`
  call is removed.
- **Callers are intentionally left unchanged.** `ConsoleServiceAccountsPage.tsx` and
  `ConsoleAuthPage.tsx` keep `onConfirm={() => void destructiveOp.handleConfirm()}`; the
  `void`-wrapper is now harmless because the dialog no longer awaits it. The inert stub in
  `ConsolePlanDetailPage.tsx:25` (`open={false} config={null}`) and the dead import in
  `ConsolePlanCreatePage.tsx` are left as-is.
- **Regression tests** (web-console vitest):
  - The existing unit test `DestructiveConfirmationDialog.test.tsx` `[RC-07]` previously asserted
    the dialog itself calls `config.onSuccess` (that encoded the bug). It is rewritten to assert
    the corrected presentational contract: clicking Confirm calls the `onConfirm` prop exactly
    once and does NOT independently call `config.onSuccess`.
  - A new composition test `DestructiveConfirmationDialog.integration.test.tsx` wires the REAL
    `useDestructiveOp` hook to the REAL dialog exactly as the pages do (nothing mocked). Scenario A
    (op rejects): an error is surfaced and `onSuccess` is NOT called. Scenario B (op resolves):
    `onSuccess` fires exactly once (no double reload). Both are RED on `main` (the dialog fires
    `onSuccess` unconditionally and, on success, in addition to the hook) and GREEN on this branch.
- **No contract artifacts changed.** This is a frontend-only behavioral fix: no `*.openapi.json`,
  no generated SDK/types, no `internal-contracts`, no `public-route-catalog.json`, no gateway
  config. Codegen produces no diff.
- **Docs**: extend `docs/reference/architecture/` with the corrected destructive-confirmation
  contract — the hook owns the op lifecycle and the dialog is presentational.

## Capabilities

### Modified Capabilities

- `web-console`: an ADDED requirement — the console's destructive-action confirmation runs an
  op's success side effects (success feedback + a single list reload) only when the op resolves
  successfully and exactly once, and on failure surfaces an error with no success feedback. No
  existing requirement in `openspec/specs/web-console/spec.md` covers the destructive-confirmation
  dialog, so this is added as `## ADDED Requirements`, not MODIFIED. (The issue's proposed delta
  was phrased as MODIFIED, but there is no base requirement to modify — modifying a non-existent
  requirement is invalid OpenSpec, so it is authored as ADDED.)
