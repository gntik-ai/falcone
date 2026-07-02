# functions - spec delta for fix-787-function-delete-capability

## ADDED Requirements

### Requirement: Delete a function with tenant-scoped teardown

The system SHALL provide a tenant-scoped way to delete a function through
`DELETE /v1/functions/actions/{id}` and through a web-console affordance with destructive
confirmation. Deleting a function SHALL remove the current function action record, retained action
versions, and action activations, and SHALL tear down the associated Knative service when the service
name is known, so functions do not accumulate without a teardown path.

Function deletion SHALL resolve the action through the caller's tenant scope before any authorization
decision or teardown side effect. Missing and cross-tenant action IDs SHALL return a scoped not-found
response without revealing existence. Same-tenant callers without a function write role SHALL be
denied before Knative service deletion or database row deletion. The Knative teardown operation SHALL
treat an already-absent service as a clean success.

The web console SHALL expose the delete control for the selected function, SHALL require destructive
confirmation, SHALL not fire the delete operation while function writes are disabled or provisioning
state is not actionable, and SHALL show success only after the DELETE request succeeds. After a
successful delete, the console SHALL refresh inventory, remove the function from the visible
inventory, and clear the deleted function's selected detail. If DELETE fails, the console SHALL keep
the function visible and selected and SHALL show the error instead of success feedback.

#### Scenario: Tenant owner deletes a function from the console

- **WHEN** a tenant owner deletes a function from the console and confirms the destructive operation
- **THEN** the function is removed from inventory, the selected detail is cleared, the function action
  row and associated retained versions and activations are deleted, and the associated Knative service
  is torn down.

#### Scenario: Function deletion is tenant-scoped before teardown

- **WHEN** an authenticated caller attempts to delete a function action ID that belongs to a different
  tenant
- **THEN** the request returns a scoped not-found response, no function action rows are deleted, and
  no Knative service delete is attempted for the foreign tenant's function.

#### Scenario: Failed console delete does not show success

- **WHEN** the console sends `DELETE /v1/functions/actions/{id}` for a selected function and the
  backend rejects or fails the request
- **THEN** the destructive confirmation remains in an error state, the selected function remains in
  the inventory and detail pane, and no success message is shown.
