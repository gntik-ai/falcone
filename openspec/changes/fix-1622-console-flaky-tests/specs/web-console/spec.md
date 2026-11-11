## MODIFIED Requirements

### Requirement: Console tests observe completed async and visual state

The parity harness and the shell navigation spec SHALL wait for the state they assert with retrying assertions, without fixed sleeps, and without skipping, retrying or loosening any test.

#### Scenario: Active context region during parity open

- **WHEN** the harness opens a route
- **THEN** it passes when the Active-context region is absent or `aria-busy="false"`
- **AND** it fails at the expect timeout if the region stays `aria-busy="true"`
- **AND** it does not call `count()` on the region.

#### Scenario: Axe scans of the admin navigation menu

- **WHEN** the shell spec scans a page with the menu open
- **THEN** it scans only after the menu is visible and document animations have settled
- **AND** it still runs the full axe ruleset, compares against the baseline and checks that no violation touches a new navigation entry.
