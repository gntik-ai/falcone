## Why

Issue #797 identifies a web-console information-architecture and visual-consistency gap in the
Functions area. The authenticated sidebar exposed several function destinations as flat,
similarly named items, making it unclear which surface to use. The thin
`/console/functions/data` screen also mixed bespoke state markup with the rest of the console's
design-system patterns.

The accepted behavior is frontend-focused: group and purpose-label the Functions destinations,
keep route labels and page titles aligned, and render the Data: Functions quick-deploy screen with
the same console primitives and explicit loading/empty/no-activation states used elsewhere.

## What Changes

- Group the console sidebar into purpose sections and co-locate the function destinations under
  `Funciones`.
- Relabel the function routes by purpose:
  - `/console/functions-registry` -> `Funciones: registro`
  - `/console/functions` -> `Funciones: administrar`
  - `/console/functions/data` -> `Funciones: despliegue rápido`
- Update the corresponding page titles to match those routing labels and add cross-signposts
  between the full management page and quick-deploy page.
- Replace the Data: Functions page's raw context guard paragraphs with `ConsolePageState`.
- Update `FunctionsConsole` state rendering so loading, empty function list, empty result,
  activation-loading, and no-activation states use `ConsolePageState`; deploy/invoke feedback
  uses `Alert`; JSON editors use `Textarea`/`Label`; commands use `Button`; and populated tools
  render in console card-style framed panels.
- Add focused Vitest coverage for both issue scenarios.
- Add docs under `docs/reference/architecture/functions-console-ia-design.md`.

## Wire / Contract Impact

This is a frontend IA/design change only. It does not change backend routes, request or response
schemas, status codes, auth/claim semantics, OpenAPI/AsyncAPI, generated clients, shared wire
types, persistence, or real-time event shapes. Public API generation should remain a no-op.
