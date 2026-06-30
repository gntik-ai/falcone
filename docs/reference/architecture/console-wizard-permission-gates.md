# Console wizard permission gates

The web console uses `useWizardPermissionCheck`
(`apps/web-console/src/lib/console-wizards.ts`) as a client-side affordance for create/provision
wizards. This gate is not the source of truth for authorization; the control-plane API remains
authoritative and can still accept or reject the submitted request.

Client-side wizard gates must therefore be no stricter than server authorization for the same role.
If the server authorizes a role for a wizard-backed action, the console should render the wizard and
let the submitted request reach the API. If the server rejects the request, the wizard should surface
that API result.

For workspace data-plane provisioning, `provision_database` and `publish_function` are available to
`tenant_owner` and `workspace_admin` principals, plus the shared global operator allow path for
`superadmin` and `platform_operator`. `tenant_member` and sessions with no recognized role remain
blocked by the client gate.

Plan or entitlement gates are separate. For example, the Functions page can still require the
`public_functions` plan capability before exposing the publish flow; once that flow is available, its
wizard role gate must follow the server role policy above.
