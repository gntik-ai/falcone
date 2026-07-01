# web-console Specification (delta)

## ADDED Requirements

### Requirement: Disambiguated Functions navigation and design-system-consistent Data: Functions screen

The system SHALL group and purpose-label the Functions navigation destinations so a user can tell
which to use, keep each page's title in agreement with the routing label, and render the
Data: Functions screen with the console design system (card layout; `Button`/`Textarea`/`Alert`/
`ConsolePageState` primitives; clear deploy/invoke feedback; explicit loading/empty/no-activations
states).

#### Scenario: Functions destinations are distinguishable

- **WHEN** a user opens the console sidebar
- **THEN** the function destinations are grouped and labeled by purpose (not three identical
  `Functions` labels with the same icon), and each function page's title matches the label that
  routed there.

#### Scenario: Data: Functions screen is design-system consistent

- **WHEN** the Data: Functions screen renders
- **THEN** it uses the shared cards and design-system primitives with consistent feedback and
  empty/loading states, matching the rest of the console.
