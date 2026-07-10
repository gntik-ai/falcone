# web-console — spec delta for add-superadmin-a11y-baseline

## ADDED Requirements

### Requirement: Superadmin surface accessibility baseline

The system SHALL meet a superadmin console accessibility baseline: dialogs SHALL be accessible
modals with role, labelling, `aria-modal`, focus trapping, and focus restoration; dirty wizard
forms SHALL NOT lose entered data on stray backdrop clicks; clickable catalog rows SHALL be
keyboard-operable through real links or buttons; routed console pages SHALL NOT emit nested
`<main>` landmarks inside the console shell; status/filter controls SHALL use the design-system
form primitives where applicable; and tabbed detail surfaces SHALL expose tablist semantics and
active state.

#### Scenario: AT user operates the tenant wizard

- **WHEN** a keyboard or assistive-technology user opens the create-tenant wizard and enters data
- **THEN** the dialog is announced as a modal, focus remains trapped inside it, Tab cycles within
  it, focus returns to the opener on close, and a stray backdrop click does not silently discard
  entered data

#### Scenario: Keyboard user opens a plan

- **WHEN** a keyboard user focuses a plan catalog link or row action and presses Enter
- **THEN** the plan detail opens through a real link or button rather than a mouse-only row click

#### Scenario: Console landmarks and controls are unambiguous

- **WHEN** a keyboard or assistive-technology user navigates superadmin plan, tenant, operations,
  and observability pages
- **THEN** the shell exposes one main landmark, routed pages use non-main content containers,
  residual filters use the shared design-system `Select`, and detail tabs expose tab semantics and
  selected state
