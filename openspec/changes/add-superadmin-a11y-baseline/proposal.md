## Why

Issue #753: several superadmin console interactions were not accessible to keyboard and
assistive-technology users. The shared `Dialog` primitive rendered a plain backdrop with no modal
semantics or focus management, and clicking the backdrop while filling the create-tenant wizard
closed the wizard and reset entered data. Plan catalog rows used a mouse-only `<tr onClick>`,
routed console pages emitted nested `<main>` landmarks inside the shell's main content, and some
filter controls bypassed the console design-system `Select`.

This is a frontend-only accessibility baseline. It does not change backend APIs, response shapes,
OpenAPI, generated clients, auth, or realtime contracts.

## What Changes

- **Shared dialog primitive** (`apps/web-console/src/components/ui/dialog.tsx`):
  - Adds default modal semantics (`role="dialog"`, `aria-modal`) at `DialogContent`.
  - Coordinates `DialogTitle` / `DialogDescription` IDs with the content's accessible name and
    description.
  - Reuses `useModalFocusTrap` for initial focus, Tab trapping, and focus restore.
  - Keeps Escape close behavior, with caller `onOpenChange` guards still respected.
  - Makes outside/backdrop close opt-in via `closeOnInteractOutside` and defaults it to `false`.
- **Wizard safety** (`WizardShell` / create-tenant path):
  - Explicitly keeps wizard backdrop interaction non-closing so stray clicks cannot reset dirty
    multi-step form data.
- **Plan catalog row semantics**:
  - Removes mouse-only row navigation and exposes real links for opening plan details.
- **Landmarks**:
  - Converts routed console page root containers that still used `<main>` to `<section>`, keeping
    the shell's `#console-main-content` as the single main landmark.
- **Design-system controls**:
  - Replaces residual raw filter `<select>` controls in the operations and observability surfaces
    with the shared `Select` primitive.
- **Docs/tests**:
  - Adds focused regression tests for modal semantics/focus behavior, wizard backdrop data
    preservation, plan keyboard navigation, single-main representative pages, and shared select
    usage.
  - Documents the superadmin accessibility baseline in the console architecture references.

## Capabilities

### Added Capabilities

- `web-console`: an ADDED requirement for a superadmin accessibility baseline covering modal
  behavior, keyboard-operable catalog rows, one main landmark, design-system filter controls, and
  accessible tab/list semantics.
