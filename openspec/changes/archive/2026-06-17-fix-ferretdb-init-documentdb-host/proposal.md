# fix-ferretdb-init-documentdb-host

## Change type
bug-fix

## Capability
tenant-provisioning (cap-tenant-provisioning)

## Priority
P1

## Why (Problem Statement)
The FerretDB init container hardcodes the DocumentDB host as
`in-falcone-documentdb` (the chart-name prefix). When the Helm release is named
anything other than `in-falcone` (e.g. `falcone`), the DocumentDB service is
prefixed with the actual release name (`falcone-documentdb`) and the init container
waits forever.

**Evidence (live campaign 2026-06-17):**
- `charts/in-falcone/values.yaml:2129` — literal `PGHOST=in-falcone-documentdb`
- Pod log: `in-falcone-documentdb:5432 - no response` → pod stuck `Init:0/1`

## What Changes
Template the init-container `PGHOST` (and any related host refs) from the Helm
release name and the component service name using `{{ .Release.Name }}-documentdb`
so it resolves correctly for any release name.

## Impact
- **Operational:** any install with a non-default release name currently deadlocks.
- **Breaking change:** none (only value templating changes).
- **Dependencies:** none.
