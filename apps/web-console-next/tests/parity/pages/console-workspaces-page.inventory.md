# Workspaces parity inventory

Page: console-workspaces-page, issue #1269, revision 5. Assigned source lease:
agent/falcone/1269/59b5daaa-f9d2-5f5c-ac36-bf572bbcebf4, clean delivery base
c36b5bf6fd8f50e30cf27525e68be6a5b40d1125. Blueprint SHA256:
d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d;
approved page entry SHA256:
e73e6d840fc6c4cd44f74c13c4171b074546d14e9120b9486b268298888e0950.

The supplied Hermes kit snapshot is
f03f36ef74718541cba4200309d136f7953de292522146a1dd01c005edd1e7bb.
Installed UI, blocks and templates remain 0.11.0; tokens remain 0.3.0. No MCP
server is available, so validate_page is NOT_RUN. Installed declarations confirm
the snapshot's component interfaces. The existing u0 API, session, shell, i18n,
CSP and parity foundations are used without modification.

## API parity

| Action | Request | Body/query | Legacy source |
| --- | --- | --- | --- |
| Mount or retry quota | GET /v1/metrics/tenants/{tenantId}/quotas | none | console-quotas.ts:116-119 |
| Mount or retry quota | GET /v1/metrics/tenants/{tenantId}/overview | none | console-quotas.ts:116-119 |
| Finish or retry create | POST /v1/tenants/{tenantId}/workspaces | name, description, initialLimits.maxFunctions and initialLimits.maxDatabases | CreateWorkspaceWizard.tsx:115-121; console-wizards.ts:130-137 |

All requests go through console-api requestConsoleSessionJson. The create payload
preserves the entered name and description, including whitespace, while limits
are trimmed and parsed as integers. The idempotent flag and wiz X-Request-Id are
preserved. The unchanged session client owns refresh, replay, invalidation and
fresh per-attempt Idempotency-Key generation. The browser and component tests
assert the same payload and different keys after a successful 401 refresh, and
one refresh with no resend and /next/console/workspaces intent on refresh failure.
No workspace metrics, list, name-check or additional page endpoint is used.
Shell tenant/workspace bootstrap remains unchanged and may repeat during navigation.

## Legacy drift and kit composition

The full supplied legacy delta was inspected. The shared API and permission
extraction, not_enforced quota mode and existing quota rounding/breach behavior
are preserved. The shared WizardShell successContent/preventResubmit additions
are unused by the legacy workspace wizard; they add no workspace behavior to port.
There are no backend, legacy, shared-contract, dependency or deployment changes.

The fixed-step gap uses its approved interim: WizardLayout overlay, its Stepper,
FormSection, kit fields and DescriptionListCard, with four explicit translated
steps. The create-wizard template's sample data is never rendered. NumberInput
coerces input to numbers and would erase legacy syntax errors, so kit Input with
inputMode=numeric preserves the required raw strings and integer matrix. The
first-run view composes EmptyState with no actions or checklist: FirstRunEmpty
in 0.11.0 always inserts an action button, which would be inert without a tenant.
Both choices follow the contract's precedence for behavior and translated copy.
No custom colors, motion, icon system or token overrides are introduced.

The header badge is adjacent to the title through PageHeader status tokens.
Viewer roles receive a warning-tone read-only badge with translated role and
visually hidden deny reason. Persisted wizard permissions are checked separately.
Every data-bearing block prop is supplied, including empty arrays, null actions,
labels, description-list items, status mappings and raw technical detail strings.
The toast region label is localized using the existing page-local adapter pattern
because the pinned Toaster exposes only its close label. No global DOM is patched.

## Fixtures and checks

The page manifest supplies the named metrics.tenant-quotas and
metrics.tenant-overview fixtures for available, delayed, exhausted, 403, 404, 500,
network, and failure-then-success reads. Create fixtures cover success, validation,
403, 404, 409, 422, 500, network, 500-then-success, 401-refresh-success and
401-refresh-failure. The superseded bare create-401 fixture is not used.
Shell fixtures are shell.tenant-admin, shell.tenant-viewer and
shell.no-active-tenant; identifiers and backend text are synthetic.

Component tests port the legacy header, create trigger, role-based indicator and
auth return journey, then exercise defaults, summary, whitespace preservation,
integer syntax/range validation, exhausted/platform quota, delayed skeletons,
each quota endpoint's independent failures, retries and focus, every localized
create error, technical-detail disclosure, duplicate Finish protection, success,
refresh and tenant-switch cancellation. Routing tests use the actual App, shell
and guard with the /next basename. Only the existing overview-shell workspaces
migration expectation changes.

The browser spec has all eight executable criteria in es and en at 375, 768 and
1280 pixels. It asserts allowed requests, payloads, retry counts, keyboard focus,
axe serious/critical results, locale, direct and client-side arrival, runtime/CSP
health and overflow. The visual-review test captures the admin, viewer, first-run,
four wizard steps, summary, quota 500, quota 403, overview 404, create 403 and
success result in both languages, with the exact named fixtures. Screenshot
attachments carry SHA256 names. Browser execution is SKIPPED in this sandbox:
Chromium unavailable; PR CI runs them. Under the November 2 amendment, CI captures
baselines and the checker/operator assess them after publication.

R3 orchestration and independent review remain required; this source-only maker
never deploys, merges, pushes or edits the deployment worktree.
