# Function Delete Lifecycle

Falcone function actions are deleted through the action-plane resource route:

```http
DELETE /v1/functions/actions/{resourceId}
Idempotency-Key: <unique-mutation-key>
```

The route returns the standard `GatewayMutationAccepted` response (`202`) when deletion is accepted.
The `resourceId` is the action identifier returned by function inventory, list, or detail responses.

## Backend Teardown

The kind control-plane delete handler first resolves the action with the caller's tenant scope:

- tenant owners/admins can delete actions owned by their own tenant;
- superadmin/internal callers can operate cross-tenant using the same null tenant-scope convention as
  function detail and rollback;
- missing or cross-tenant action IDs return `404 ACTION_NOT_FOUND` before any authorization detail can
  leak existence;
- same-tenant callers without a function write role receive `403 FORBIDDEN` before any Knative or
  database side effect.

When an owned action is accepted for deletion, the handler requests deletion of the stored
`ksvc_name` through `deleteKnativeService`. That helper treats a Kubernetes `404` from Knative as
success, which keeps retry behavior safe when the service was already removed by a prior attempt or
cluster garbage collection.

After the service delete request succeeds, the store removes the action's durable rows:

| Table | Delete predicate |
| --- | --- |
| `fn_activations` | `resource_id` plus the resolved action's `workspace_id` |
| `fn_action_versions` | `resource_id` plus the resolved action's `tenant_id` |
| `fn_actions` | `resource_id` plus the resolved action's `tenant_id` |

The row predicates are derived from the already-resolved action row, never from request body scope.
That prevents a delete request for one tenant from removing another tenant's action history or
Knative service.

## Console Behavior

The web console exposes deletion from the selected function detail header. The control is disabled
while the selected function is in a non-actionable provisioning state. Before sending the DELETE, the
console uses the shared destructive confirmation dialog and requires the operator to type the exact
function name.

On success, the console clears the selected function detail, removes the row from the local inventory
view, displays a success message, and reloads inventory from the backend. On failure, the destructive
dialog stays open with the backend error, the selected row remains visible, and no success message is
shown.
