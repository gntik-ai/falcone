# Design and test seams

- HTTP request boundary: root/deep links, raw relative redirect matrix, traversal,
  immutable assets/missing assets, health, proxy path/body/headers, identical CSP.
  The transport-only fixture exercises the shipped handler and actual filesystem
  without sockets. CI also exercises Node and nginx with real listeners.
- Release CLI: independently committed blocking list and closure evidence; exact
  item set, CLOSED/COMPLETED, merged PR in the recorded repository, exact issue
  reference and merge-before-close. API replay uses offline fixtures and is forbidden
  in CI. API errors fail closed; no GitHub closer association is required.
- Parity validator CLI: explicit rows or a provable immutable object spread;
  unresolved, shadowed, defaulted, mutated/reassigned and overriding spreads fail.
- Parity browser boundary: guard open, actions, asynchronous readiness assertions
  and teardown. Negative journey adds sample copy only after open has completed.
- Docker CLI: a scratch build copies a marker from next/dist using the actual
  root build context; runtime test uses read-only root and UID 1000 and validates
  next-only layout, release metadata, and absence of package credential material.

The nginx maps use the raw request URI, normalizing only encoded unreserved
letters of the next prefix. Reserved suffix/query bytes remain unchanged.
Traversal is rejected before routing/redirects. A suffix that could produce a
network-path redirect is rejected instead of emitting an external Location.
Security headers are location-scoped so proxy responses remain undecorated.

Rollback evidence is operator-recorded from staging imageID and the GHCR manifest
on 2026-11-19. The switch digest must be recorded after publication. A staging
rollback rehearsal must restore the prior console and preserve an existing session.
Screenshots, parity in both languages, axe and viewport journeys run in PR CI;
visual assessment and baseline approval remain with the checker and operator.
