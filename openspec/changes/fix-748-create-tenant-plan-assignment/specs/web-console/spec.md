# web-console - spec delta for fix-748-create-tenant-plan-assignment

## ADDED Requirements

### Requirement: Create-tenant wizard uses the real plan catalog for initial assignment

The system SHALL populate the create-tenant wizard's plan selector from the real active plan catalog
and SHALL assign the chosen catalog plan to the new tenant by submitting the selected catalog plan ID
to the tenant creation API. The wizard SHALL NOT offer phantom hardcoded plan options that are not
backed by records returned from the active plan catalog. When the active catalog is loading, cannot
be loaded, or is empty, the wizard SHALL present an accessible in-step loading, error, or empty state
and SHALL prevent progression past the Plan step until a real active catalog plan can be selected.

#### Scenario: Creating a tenant with a selected catalog plan assigns that plan

- **WHEN** a superadmin completes the create-tenant wizard choosing a catalog plan
- **THEN** the wizard posts the selected catalog plan ID to `POST /v1/tenants`, and
  `GET /v1/tenants/{id}/plan` reflects that plan instead of `noAssignment`
