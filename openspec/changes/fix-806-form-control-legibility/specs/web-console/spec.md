# web-console — spec delta for fix-806-form-control-legibility

## ADDED Requirements

### Requirement: Console form controls are legible in the dark theme

The system SHALL render every console form control (`<input>`, `<select>`, `<textarea>`) with a
theme-correct foreground and background so that the control's text and the user-entered value
meet WCAG 2.1 AA contrast (≥ 4.5:1) in the dark theme. Console form controls SHALL use the
design-system primitives (`Input`, `Select`, `Textarea` from `@/components/ui/*`), which carry
`bg-background` (and, for `Input`, `text-foreground`); as a defense-in-depth safety net, the
console's base stylesheet SHALL apply `bg-background` and `text-foreground` to native
`input`/`select`/`textarea` elements so that no control falls back to the user-agent white
background (which, combined with Tailwind preflight's `color: inherit`, would yield
near-white-on-white text). The safety net SHALL be applied in the lowest-priority style layer
so it never overrides an explicitly-styled control.

#### Scenario: typing on a data-plane editor is legible

- **WHEN** an operator types a database / schema / table / collection / topic name into a
  data-plane editor field (e.g. the Postgres, Mongo, or Events console)
- **THEN** the typed text is rendered with the dark-theme foreground on the dark-theme
  background (not near-white-on-white) and meets WCAG 2.1 AA contrast (≥ 4.5:1)

#### Scenario: the realtime subscribe form is legible

- **WHEN** an operator enters or selects values in the realtime subscribe form (the source
  `<select>` and the database / collection / key inputs)
- **THEN** each entered or selected value is rendered with the dark-theme foreground on the
  dark-theme background and meets WCAG 2.1 AA contrast (≥ 4.5:1)
