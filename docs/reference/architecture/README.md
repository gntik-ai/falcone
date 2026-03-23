# Architecture Reference Assets

This directory documents architecture baselines that future tasks should extend rather than replace.

## Current baseline

- `docs/adr/0003-control-plane-service-map.md` records the control-plane service split and dependency rules.
- `services/internal-contracts/src/internal-service-map.json` is the machine-readable source of truth for the internal service map and contract catalog introduced by `US-ARC-01-T01`.

## Usage rules

- Update the machine-readable source before adding new consumers.
- Keep provider-specific concerns behind adapter ports.
- Preserve append-only audit semantics.
- Add deliberate versioning notes when changing internal contract shapes.
