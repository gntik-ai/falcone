# Console plan lifecycle and removal

The superadmin plan detail page (`/console/plans/{planId}`) is the console entry point for
operating the full plan lifecycle. A plan is not just a document with editable limits; it
is a governed platform catalog record with a forward-only lifecycle:

```text
draft -> active -> deprecated -> archived
```

## Console flow

The plan detail header shows the current status and the next valid lifecycle action:

- `draft` plans show **Activar plan**.
- `active` plans show **Marcar como obsoleto** behind confirmation.
- `deprecated` plans show **Archivar plan** behind confirmation.
- `archived` plans have no further lifecycle transition.

After a successful transition, the console refreshes the plan and updates the displayed
status in place. Failed transitions surface the backend error and do not change the visible
status.

The detail page also shows **Eliminar plan**. Deletion is guarded by the shared destructive
confirmation dialog and requires the operator to type the plan display name before the
request is sent. On success, the console returns to `/console/plans`.

## API contract used by the console

The console uses the authenticated plan-management client
(`apps/web-console/src/services/planManagementApi.ts`) and these control-plane routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/plans/{planId}/lifecycle` | Apply the next forward lifecycle transition with `targetStatus` set to `active`, `deprecated`, or `archived`. |
| `DELETE` | `/v1/plans/{planId}` | Hard-delete a plan only when it has never been assigned to a tenant. |
| `GET` | `/v1/plans/{planIdOrSlug}` | Refresh the plan detail after lifecycle mutation. |

`DELETE /v1/plans/{planId}` is intentionally conservative. It is superadmin-only and
returns `PLAN_HAS_ASSIGNMENT_HISTORY` with HTTP 409 when the plan has any active or
historical tenant assignment. Those plans must be retired through the lifecycle path
(`active -> deprecated -> archived`) rather than hard-deleted, preserving entitlement
history and avoiding broken foreign keys from tenant assignment history.

Never-assigned plans can be hard-deleted. The backend preserves audit integrity by keeping
audit rows, detaching their nullable `plan_id` foreign key before the plan row is removed,
and inserting a `plan.deleted` audit event whose snapshot contains the deleted plan. It also
emits the `console.plan.deleted` plan event for downstream observers.

## Operator guidance

Use **Archivar plan** for plans that were ever assigned to tenants, even if they are no
longer active assignments. Use **Eliminar plan** for draft/test/obsolete plans that were
created but never assigned. A 409 `PLAN_HAS_ASSIGNMENT_HISTORY` response means the operator
should retire the plan through deprecate/archive instead of retrying deletion.
