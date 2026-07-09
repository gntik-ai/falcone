# web-console — spec delta for add-console-plans-design-system

## ADDED Requirements

### Requirement: Superadmin Plans surfaces use the shared console design system

The system SHALL render the superadmin Plans surface and tenant wizard with the console's
established visual language: shared styled tables, shared tab controls with active state,
theme-aware status badges, consistent page headers, and polished form and empty states. The shared
`Table` and `Tabs` UI primitives SHALL encode the table and tab conventions, and the Plans pages
and tenant wizard SHALL consume those primitives and theme-aware status badges instead of
hand-rolled equivalents.

#### Scenario: Plans catalog and detail use shared Table and Tabs conventions

- **WHEN** a superadmin opens `/console/plans` and then opens a plan detail
- **THEN** the catalog renders a styled shared `Table` (padded cells, shared header treatment,
  hover treatment, and cursor affordance on clickable rows), and the detail tab strip renders
  through the shared `Tabs` primitives with the active tab visually and semantically marked

#### Scenario: Tenant wizard progress and plan status affordances are theme-aware

- **WHEN** a superadmin advances through the tenant-creation wizard and views plan statuses in the
  Plans flow
- **THEN** the wizard distinguishes current, completed, and upcoming steps, and plan status badges
  use theme-aware translucent status tones rather than light-mode chips
