# web-console — spec delta for fix-746-tenant-plan-quantitative-limits

## ADDED Requirements

### Requirement: Superadmin per-tenant plan page reads effective quota limits from `quantitativeLimits`

The system SHALL render the superadmin per-tenant plan page
(`/console/tenants/{tenantId}/plan`) without an unhandled exception, showing the tenant's
effective quota limits and the assign/change-plan control. The page SHALL read the quota
limits from the effective-entitlements API's `quantitativeLimits` collection (the field
returned by the `EffectiveEntitlementProfile` model), using each entry's `currentUsage`
for the consumption column, and SHALL guard the field so that an absent or empty
`quantitativeLimits` renders an empty limits table rather than throwing.

#### Scenario: Superadmin opens the per-tenant plan page and the limits render from `quantitativeLimits`

- **WHEN** a superadmin opens `/console/tenants/{tenantId}/plan` and the
  effective-entitlements API returns a profile whose `quantitativeLimits` contains one or
  more entries (each with `dimensionKey`, `effectiveValue`, `currentUsage`, `usageStatus`)
- **THEN** the page renders the quota limits from `quantitativeLimits` (each row's
  consumption populated from `currentUsage`) and the assign/change-plan control, with no
  React error boundary activation and no thrown exception / blank screen

#### Scenario: Absent `quantitativeLimits` renders an empty limits table without crashing

- **WHEN** a superadmin opens `/console/tenants/{tenantId}/plan` and the
  effective-entitlements API response omits `quantitativeLimits`
- **THEN** the page renders the limits table with no rows (and the assign/change-plan
  control) without throwing a `TypeError` or triggering the route error boundary
