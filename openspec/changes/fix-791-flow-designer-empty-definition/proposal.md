## Why

Freshly-created flow drafts can be returned by the flows API as `definition: {}` because the
definition store defaults `definition_json` to an empty object until the user saves a DSL document.
The console flow designer projected that raw object directly onto the canvas and assumed
`definition.nodes` existed, so opening a new draft could throw `Cannot read properties of undefined
(reading 'forEach')` instead of showing a blank canvas.

This blocks tenants from using the visual designer for brand-new flows and makes the console
inconsistent with the backend's draft lifecycle.

## What Changes

- Normalize loaded flow definitions in `ConsoleFlowDesignerPage` so a record whose definition lacks
  `nodes` becomes a valid empty canvas base definition (`nodes: []`) before it seeds canvas state or
  the save projection.
- Make `flowGraphModel.ts` tolerant at the projection boundary: `definitionToNodes`,
  `definitionToEdges`, and `autoLayout` treat missing node arrays as empty.
- Add focused Vitest regression coverage for `definitionToNodes({})`, `definitionToEdges({})`, and
  `autoLayout(undefined)`.
- Document the draft-definition boundary in the flows architecture docs.
- No OpenAPI, generated SDK, route catalog, backend API shape, or gateway contract changes are
  required; this is a console projection fix for an already-observed API record shape.
