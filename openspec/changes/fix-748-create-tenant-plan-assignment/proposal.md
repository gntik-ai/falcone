## Why

Issue #748 is a confirmed create-tenant wizard defect. The wizard's Plan step offered hardcoded
`starter` / `growth` choices instead of reading the active plan catalog, so an operator could choose
a phantom plan that did not necessarily exist in `/v1/plans`. The tenant create request still sent
that literal value to `POST /v1/tenants`, which could leave the new tenant without the plan the
operator intended.

The control-plane create-tenant route already accepts `planId` and calls `assignPlanBestEffort`,
which can assign resolvable plan UUIDs or slugs during tenant creation. The minimal correct fix is
therefore to make the frontend choose from real active catalog records and submit the selected plan
record's `id`.

## What Changes

- `apps/web-console/src/components/console/wizards/CreateTenantWizard.tsx`
  - Loads active plans with `listPlans({ status: 'active', page: 1, pageSize: 100 })` while the
    wizard is open for an authorized superadmin.
  - Renders only catalog-backed plan options. Option labels use the plan display name and slug, and
    option values are the real plan IDs sent to `POST /v1/tenants`.
  - Removes the hardcoded Starter/Growth choices.
  - Blocks progression during catalog loading, catalog errors, or an empty active catalog, with
    accessible in-step status/error messaging.
- `apps/web-console/src/components/console/wizards/CreateTenantWizard.test.tsx`
  - Adds focused regression coverage for the issue scenario: the wizard fetches active catalog
    plans, offers real catalog options, does not offer the phantom Starter/Growth options, and posts
    the selected real plan ID to `/v1/tenants`.
  - Adds empty-active-catalog coverage so the Plan step stays disabled instead of offering
    fabricated choices.
- `docs/reference/architecture/console-create-tenant-plan-assignment.md`
  - Documents the create-tenant plan selection and assignment flow across console and control plane.

## Capabilities

### Modified Capabilities

- `web-console`: add a create-tenant wizard requirement that the Plan step is sourced from the real
  active plan catalog and that tenant creation submits the selected catalog plan ID for creation-time
  assignment. This is an ADDED requirement because no base OpenSpec requirement for this wizard exists
  in the repository.

## Backend / Wire Assessment

No backend route, OpenAPI/AsyncAPI, generated client, or shared contract artifact changed. The
existing kind control-plane route `POST /v1/tenants` already forwards `body.planId` to
`assignPlanBestEffort`, and `GET /v1/tenants/{tenantId}/plan` is already the assignment read model
served by the plan-management route family. The wire shape remains backward compatible: the frontend
continues to send `planId`, but now it is the selected catalog record ID rather than a hardcoded
phantom value.
