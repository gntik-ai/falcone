# observability - spec delta for fix-765-audit-record-filters

## MODIFIED Requirements

### Requirement: Audit-record query honors filter parameters

The system SHALL apply `outcome`, `actionCategory`, `actorId`, and time-range filters to the
audit-record query and return only matching, tenant-scoped records; unknown filter values SHALL NOT
silently return the full set.

#### Scenario: Outcome filter narrows

- **WHEN** `filter[outcome]=failed` is supplied
- **THEN** only failed-outcome records are returned.

#### Scenario: Category / actor filter narrows

- **WHEN** `filter[actionCategory]` or `filter[actorId]` is supplied
- **THEN** only records matching that category/actor are returned.

#### Scenario: Time range filter narrows

- **WHEN** `filter[occurredAfter]` and/or `filter[occurredBefore]` is supplied
- **THEN** only records whose event timestamp falls within the requested time range are returned.
