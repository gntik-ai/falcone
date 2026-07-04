# Console destructive-action confirmation — the hook owns the op lifecycle

Destructive console actions (delete a plan, delete a service account, revoke a credential,
detach an identity provider, …) are confirmed through the shared
`DestructiveConfirmationDialog`
(`apps/web-console/src/components/console/DestructiveConfirmationDialog.tsx`). The contract between
that dialog and its controller hook `useDestructiveOp`
(`apps/web-console/src/components/console/hooks/useDestructiveOp.ts`) determines when "success"
feedback is shown — and getting it wrong is security-relevant, because a credential **revoke** that
falsely reports success can mislead an operator into thinking access was cut when it was not.

## The two pieces

- **`useDestructiveOp` (the controller) owns the operation lifecycle.** `openDialog(config)` opens
  the dialog (and, for `CRITICAL` ops on supported resource types, fetches the cascade-impact
  preview). `handleConfirm()` is the single place that runs the op: it sets `opState = 'confirming'`,
  `await`s `config.onConfirm()`, and then:
  - **on success** — resets state and calls `config.onSuccess` **exactly once** (the success
    feedback + the single list reload);
  - **on failure** — sets `confirmError` (a user-facing message derived from the error/HTTP status)
    and `opState = 'error'`, and runs **no** success side effects.
- **`DestructiveConfirmationDialog` is presentational.** It renders the confirmation copy, the
  cascade-impact summary, the `CRITICAL` "type the resource name" guard, and the inline
  `confirmError` (`role="alert"`). Its confirm button only **triggers** the operation:

  ```tsx
  onClick={() => onConfirm()}
  ```

  The dialog does **not** await the op and does **not** call `config.onSuccess` itself. Success and
  error are entirely the controller's responsibility; the dialog reflects them through the
  `opState` / `confirmError` props it is given.

## Why the dialog must not run the success side effects

Pages wire the dialog as `onConfirm={() => void destructiveOp.handleConfirm()}` — the `void`
intentionally discards the promise so the click handler is synchronous. That is fine **only because
the dialog no longer awaits `onConfirm` or runs success side effects**. If the dialog tried to
`await Promise.resolve(onConfirm())` and then call `config.onSuccess?.()` itself, two defects would
follow (issue #780):

- `await Promise.resolve(undefined)` settles on the next microtask — long before the real backend
  op (awaited inside `handleConfirm`) resolves — so `config.onSuccess` would fire **unconditionally**,
  showing "success" even when the op later **fails** (including a failed credential revoke).
- On success, `config.onSuccess` would fire **twice** (once from the dialog, once from the hook) —
  a double list reload.

**Rule:** the controller hook is the single owner of a destructive op's result. The dialog triggers
the op and renders the controller's `opState`/`confirmError`; it never awaits the op and never runs
`config.onSuccess`. Success feedback and the list reload happen once, only when the op resolves
successfully; a failed op surfaces an error with no success feedback.

## Focus management: Tab-trap and focus-return (#783)

`DestructiveConfirmationDialog` sits on the shared `ui/dialog.tsx` primitive, which only renders a
backdrop overlay and click-outside-to-close — it provides none of the keyboard-accessibility
semantics a modal needs. The dialog wires the shared
`useModalFocusTrap` hook (`apps/web-console/src/components/console/hooks/useModalFocusTrap.ts`) onto
its `role="alertdialog"` panel to add:

- **Focus-on-open**: moves focus onto the first focusable descendant of the panel (the "type the
  resource name" input for a `CRITICAL` confirmation, or the Cancelar button when there is no such
  input) as soon as the dialog opens.
- **Tab-trap**: `Tab` from the last focusable element wraps back to the first, and `Shift+Tab` from
  the first wraps to the last — focus never escapes into the page behind the dialog while it is open.
- **Focus-return**: closing the dialog (Cancelar, Escape, or a successful confirm) restores focus to
  whatever control had focus immediately before the dialog opened (the row action that triggered it).

Escape-to-close is handled separately by a `window`-level `keydown` listener (unchanged by this
hook) that is disabled while `opState === 'confirming'`, so an in-flight destructive op cannot be
dismissed out from under itself.

The same `useModalFocusTrap` hook backs `ConsoleWorkspaceSecretsPage`'s `SecretDialog` and
`ConsoleServiceAccountsPage`'s credential-disclosure modal (see
[`service-account-credential-lifecycle.md`](./service-account-credential-lifecycle.md#console-ux-credential-disclosure-modal-and-status-badge-783)),
so the trap/return semantics live in exactly one place instead of being re-implemented per dialog.

## Plan lifecycle usage

The plan detail page uses the shared dialog for destructive plan actions:

- `active -> deprecated`
- `deprecated -> archived`
- `DELETE /v1/plans/{planId}`

Plan deletion is `CRITICAL`: the operator must type the plan display name before the API call is
made. Lifecycle retirement transitions are `WARNING`: they still require confirmation because the
state machine is forward-only. See
[`console-plan-lifecycle-removal.md`](./console-plan-lifecycle-removal.md) for the plan-specific
route semantics and the `PLAN_HAS_ASSIGNMENT_HISTORY` refusal path.
