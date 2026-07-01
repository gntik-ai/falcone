# Console workspace route context

Workspace-scoped console routes that include a `workspaceId` path parameter restore shell context from
that route when the console opens or refreshes directly on the URL. Examples include:

- `/console/workspaces/{workspaceId}`
- `/console/workspaces/{workspaceId}/docs`
- `/console/workspaces/{workspaceId}/realtime`

On load, the shell validates the route workspace through the existing accessible tenant and workspace
list APIs. If the workspace belongs to one of the user's accessible tenants, the shell selects that
tenant first and then marks the route workspace active. The header tenant/workspace selectors and
workspace-scoped pages therefore receive the same context a user would get after manually selecting
the workspace.

If the route workspace is not accessible to the current session, the shell leaves the active
workspace unset and does not fall back to a different persisted workspace while that route id is
present. This avoids showing or querying data for an unrelated workspace on a deep link the user
cannot access.

This behavior is frontend-only. It uses existing console APIs and does not change OpenAPI schemas,
generated clients, response shapes, status codes, or authorization rules.
