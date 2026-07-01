# Functions Console IA and Quick-Deploy Design

The web console exposes three Functions destinations. They must stay grouped in the sidebar under
`Funciones` and each route's page title must match the navigation label that opened it:

| Route | Navigation label and page title | Purpose |
| --- | --- | --- |
| `/console/functions-registry` | `Funciones: registro` | Register legacy workspace function rows while the data plane is pending. |
| `/console/functions` | `Funciones: administrar` | Manage the full serverless lifecycle: inventory, detail, versions, activations, triggers, deploy, invoke, and rollback. |
| `/console/functions/data` | `Funciones: despliegue rápido` | Use the thin JSON deploy/invoke/activation probe over the functions executor. |

The quick-deploy route is intentionally narrow. It is useful for a fast JSON-shaped deploy and
invoke loop, but version history, rollback, trigger inspection, and richer operational detail belong
on `Funciones: administrar`. Each page should signpost the other when the user's task likely belongs
there.

## Sidebar grouping

The authenticated shell groups navigation destinations by purpose. Functions entries stay together
under `Funciones`, while row/document/event/realtime editors stay under `Plano de datos`. Do not add
a new function-related route as another flat `Funciones` item; add it to the grouped navigation with
a purpose-specific label and an icon that communicates that purpose.

## Quick-deploy screen states

`/console/functions/data` uses the same console design-system primitives as the surrounding admin
console:

- context guards render with `ConsolePageState`;
- loading, empty function list, empty result, activation-loading, and no-activation states render
  with `ConsolePageState`;
- deploy/invoke feedback renders with `Alert`;
- JSON editors render with `Textarea` and `Label`;
- commands render with `Button`;
- framed panels use the console card layout (`border`, `bg-card`, spacing, and shadow) only for
  actual tools or populated result/activation panels.

The screen continues to use the contract mapping documented in
`docs/reference/architecture/functions-data-console-contract.md`. This IA/design change is
frontend-only and does not change function API routes, request/response schemas, auth claims,
OpenAPI, generated SDKs, or real-time event shapes.
