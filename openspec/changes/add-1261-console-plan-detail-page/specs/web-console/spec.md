## ADDED Requirements

### Requirement: Superadmin plan detail

The next console SHALL serve `/console/plans/:planId` through its migrated flag and a lazy
superadmin-guarded dispatch. It SHALL compose the resource-detail layout from gntik-ui 0.11.0
with explicit props and complete es-default/en copy, accessible names and announcements.

#### Scenario: Load and render

- **WHEN** a superadmin opens the route
- **THEN** it SHALL send one GET `/v1/plans/{id}` and one GET `/v1/plans/{id}/limits` in parallel.
- **AND** it SHALL render the plan name as h1, the status, slug, a four-step lifecycle stepper and
  the tabs Informacion, Capacidades, Limites and Asignaciones.
- **AND** the status timeline SHALL hold exactly one entry, the current status at `updatedAt`.
- **AND** a non-superadmin SHALL be stopped by the guard and send no plan request.

#### Scenario: Lifecycle and deletion

- **WHEN** the plan is a draft, active or deprecated
- **THEN** exactly the transitions Activar (no confirmation), Marcar como obsoleto (alert dialog)
  or Archivar (typed plan name) SHALL be offered, and none for an archived plan.
- **AND** Eliminar SHALL be disabled, not hidden, while the plan is active or an action is busy.
- **AND** Eliminar and Archivar SHALL send no request until the typed text equals `displayName`.
- **AND** a successful delete SHALL navigate to `/console/plans`.
- **AND** a successful lifecycle SHALL show the accepted new status with a toast and an
  announcement even when the reload GET fails.

#### Scenario: Limits

- **WHEN** a draft or active plan shows its limits
- **THEN** Enter on a valid changed value SHALL send one PUT `{value}`; Escape, blur, focus,
  unchanged and invalid values SHALL send nothing; values below -1 SHALL fail validation and -1
  SHALL mean unlimited.
- **AND** incomplete or malformed text in the field (for example `-`) SHALL be treated as invalid
  from the visible text, so the last parsed number SHALL never be sent.
- **AND** deprecated and archived plans SHALL expose no limit-mutation control.

#### Scenario: Failures and lost responses

- **WHEN** a mutation fails with 5xx or a network error
- **THEN** an error panel with status code, request id and localized copy SHALL appear in the open
  dialog, above the tabs (Activar) or under the table (Guardar), and Reintentar SHALL re-send the
  identical request.
- **AND** a lost lifecycle response SHALL send one POST, show outcome-unknown copy and re-send only
  after Reintentar, and the original lifecycle trigger SHALL stay disabled while that outcome is
  unresolved; a lost plan or limit DELETE SHALL use the standard retry.
- **AND** a 403 SHALL render no-access and disable every mutation control.
- **AND** a lifecycle POST or plan DELETE answered with 401 SHALL refresh the session once and
  SHALL NOT be replayed.
- **AND** raw backend messages SHALL never render.
