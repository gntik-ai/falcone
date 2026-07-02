# web-console Specification (delta)

## ADDED Requirements

### Requirement: Design-system-aligned, accessible Functions authoring & operations UX

The system SHALL present function authoring, invocation, and history with design-system primitives,
accessible tabs, severity-encoded status, monospace code/log surfaces, and one coherent primary
deploy action.

The Functions page SHALL (a) edit code and JSON in monospace, spellcheck-off surfaces using
`lib/editor-ux.ts` helpers (`parseJsonObject` and `prettyJson`); (b) render logs, results, and
operation outcomes through a shared console block and the `Alert` primitive; (c) color-encode
action, version, invocation, and activation status via design-system-consistent tone classes;
(d) make the detail tabs a keyboard-accessible tablist; (e) present the working inline deploy path
as the coherent primary deploy action without a leaking capability badge; and (f) close the
invoke-to-result loop by linking/selecting the activation, refetching activations, and rendering the
awaited result.

#### Scenario: Functions page parity with the console standard

- **WHEN** a tenant owner edits code/payload, deploys, invokes, and inspects results/logs/versions
- **THEN** the editors are monospace, outcomes route through the `Alert` primitive, status is
  color-encoded, the tabs are a keyboard-accessible tablist, and the working deploy path is the
  clear primary action.
