## ADDED Requirements

### Requirement: Advertised public routes MUST match the runtime

The system SHALL ensure that every route published in the public OpenAPI catalog either responds at runtime or is removed from the catalog, so that no advertised route returns `NO_ROUTE`.

#### Scenario: An advertised route responds or is not advertised

- **WHEN** a client calls any route present in the published OpenAPI catalog
- **THEN** the route responds (success or a defined error) and does not return `NO_ROUTE`

#### Scenario: Catalog and runtime are in parity

- **WHEN** the published catalog is compared against the live runtime routes
- **THEN** there are no advertised routes that are unimplemented at runtime
