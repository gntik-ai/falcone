# Members parity inventory

Assigned lease: branch agent/falcone/1266/051431e9-fe35-58d8-987e-1b83a99c79b2,
clean base a19f40ab9e160cd522c110efd50c30b2f5e0d708. Blueprint SHA256
 d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d;
approved entry a83361e00e7de747bedde12c9704cce06be574b7ee1813b9b0b1387e3b5f1073.
Hermes kit snapshot d329505fdb463883ff0d707b084c9817e4b01bdc13ce7e5f3d98aa8aa7bc84b9,
ui/blocks/templates 0.11.0, tokens 0.3.0. MCP is unavailable; installed types verify
WizardLayout's explicit error status support. Its full Stepper omits aria-current
for error status, so the supported rich label slot carries aria-current on the
current errored step; the kit still owns the indicator, layout and navigation.

## Requests and preserved actions

All calls use console-api requestConsoleSessionJson without changing shared code.

| Action | Method and path | Query/body |
| --- | --- | --- |
| Load/retry all users | GET /v1/iam/realms/{realm}/users | page[size]=100; page[after] only on continuations |
| Load/retry roles | GET /v1/iam/realms/{realm}/roles | page[size]=100 |
| Open invite | GET /v1/metrics/tenants/{tenant}/quotas and /overview | none |
| Open invite | GET /v1/metrics/workspaces/{workspace}/quotas and /overview | none |
| Create user and reload | POST /v1/tenants/{tenant}/users | trimmed username/password, optional trimmed email, roles array |
| Submit invite | POST /v1/tenants/{tenant}/invitations | exactly email, role, workspaceId; idempotent=true; wiz X-Request-Id |
| Load/retry invitations (extra action 1) | GET /v1/tenants/{tenant}/invitations | none |
| Revoke (extra action 2) | POST .../invitations/{id}/revocation | {} |
| Resend (extra action 3) | POST .../invitations/{id}/resend | {email} |

Other preserved actions: toggle create, Back/Next/Edit, Exit/Escape/Close. No
message, acceptance, getInvitation, realm lookup or other endpoint is added.
Revocation has no confirmation. A failed mutation keeps invitation rows and the
legacy message; a failed list GET clears rows. Toolbar uses shell permissions;
blocked invite deliberately diverges persisted roles after manager-shell load.
401 follows one refresh/one replay through the unchanged session helper, including
its existing per-attempt Idempotency-Key generation and preserved X-Request-Id.

## Intended differences authorized by revision 5

- Metrics load on wizard open rather than legacy mount.
- Enabled Next validates and announces the current step; kit error marks persist.
- Summary Edit controls return to each field's step.
- Fullscreen overlay-mode WizardLayout replaces the legacy dialog; open focuses
  the heading. The kit owns the portal, modal isolation, Escape and focus return.
  Its description and step announcements use the legacy localized copy.
- Failed invitation GET clears prior rows rather than retaining stale ones.
- Users follow the approved cursor contract and deduplicate overlapping userIds.

Revision 5's four steps, no message, exact POST and shared localized create/IAM
5xx copy supersede the earlier blueprint text. Invitation lifecycle additions
since blueprint are preserved, including masked/trimmed password, pending-only
revoke, non-accepted resend, legacy fragment proof and proof cleanup.

## Fixtures and evidence

The page manifest names every approved fixture plus invitation defaults:
members:invitations-mixed, members:invitations-empty, members:invitations-500,
members:invitations-network, members:invitation-revoke-ok,
members:invitation-revoke-500, members:invitation-resend-ok and
members:invitation-resend-500. alice/bob, tenant_owner/tenant_developer and
UPDATE_PASSWORD mirror the legacy context-auth journey's J01/J02 directory
assertions; identifiers and addresses are synthetic. The legacy invitation
journeys were fixme; the migrated spec exercises invite/revoke/resend explicitly.

Named roles: members:role-tenant-owner, members:role-tenant-viewer;
shell:tenant-with-realm, shell:tenant-none, shell:tenant-without-realm;
members:invite-permission-denied uses a manager shell with a lowered persisted
session. Component tests also cover delayed/failed continuations, a repeated
cursor, tenant changes during loading, list section isolation, pending/exhausted
quota, invalid fields, duplicate Finish, 401 replay, proof cleanup and rollback.

Eight executable parity checks run for es/en at 375/768/1280. Visual coverage
captures the manager view, read-only view, create panel, workspace/email/role/
summary, blocked view, failed summary and users error with the named fixtures.
Screenshots have SHA256 attachment names. Both / and /next builds are supported.
Per the November 2 amendment, PR CI captures screenshots and the operator reviews
baselines afterward; no screenshots are claimed from this sandbox. Chromium,
axe, viewport, parity and CSP runs are deferred to CI. The checker assesses the
visual spec and fixtures in source. Kit composition uses Page plus explicit
resource-index blocks to avoid sample rows, search, paging or management actions
that ResourceIndexPage adds but legacy does not have.

## Checker follow-up

The page-local locale assertion retains the shared locale rules with one narrow
exception for legacy catalog labels: Email and formatConsoleEnumLabel lifecycle
values (Draft, Provisioning, Pending activation, Active, Suspended, Soft deleted,
Deleted). These are deliberately identical in this page's es/en catalogs. Other
pages translate the same English words, making the shared cross-catalog rule
reject this page's preserved Spanish copy. No product copy or shared assertion
was changed; all other English-copy and untranslated-key checks remain active.

Required-password journeys use the label including the kit's required marker.
The no-tenant fixture now returns no tenant on both collection and own-tenant
bootstrap paths. Responsive checks inspect the active modal while the kit hides
the underlying shell main. Current-step assertions select the visible stepper.
Double activation dispatches two clicks on the same Finish element; it does not
wait for a removed button before dispatching the second activation.

Success uses the kit step announcement to announce completion and focus the proof
heading inside the modal; Escape and Cerrar both dismiss proof,
return focus and reload invitations once. Invite failures preserve the localized
legacy 401/403/409/422 messages and generic operation fallback for other errors;
backend messages never render. Create and IAM retain their separate console-errors
mapping. Regression tests cover closing create during submission and clearing
revoke/resend errors on the wizard-close reload.

The second checker follow-up imports the workspace bootstrap fixture explicitly
and validates the rollback requirement text with strict OpenSpec validation. The
blocked invite uses the kit assertive callout with its denial reason and announces
Access blocked instead of a step. The read-only indicator keeps its recourse in
a visually hidden text child, matching the legacy text-content assertion.

The es/en browser journey now selects members:users-401 and asserts one refresh,
one users replay, login and preserved return intent. Accessibility coverage checks
the manager directory, every wizard step, email and missing-role validation, the
failed Finish summary and the tenant_viewer indicator, including its reason. Back,
Next and Finish are activated by keyboard; successful Close, Exit and Escape
restore Invite focus. Browser execution remains deferred to PR CI.
