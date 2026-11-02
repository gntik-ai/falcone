# Administrator console entry point

## ADDED Requirements

### Requirement: Responsive evidence is taken with the menu opened at each width

The shell test SHALL verify `documentElement.scrollWidth <= clientWidth` at 375, 768 and 1280 px, with the user menu closed and with it opened at that width, for superadmin and tenant_owner on `/console/overview` and `/admin`, in en and es. The menu SHALL be closed before every resize, and a state opened at another width SHALL NOT count as evidence.

#### Scenario: Reopen after resize

- GIVEN the user menu opened at 1280 px
- WHEN the viewport is resized to 375 px
- THEN the menu is closed first, reopened at 375 px and only then measured.

#### Scenario: Entries and accessible names

- GIVEN a superadmin on `/console/overview` or `/admin`
- WHEN the menu is opened at any of the widths
- THEN the Admin console (or Console) menuitem is inside the viewport
- AND the top-bar admin link keeps the accessible name `Admin console` / `Consola de administración` and href `/next/admin`
- AND a tenant_owner sees neither entry.
