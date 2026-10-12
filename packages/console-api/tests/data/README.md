# Base session compatibility fixture

`base-session.json` is the sessionStorage value produced by
`persistConsoleShellSession` at immutable source base `7acbac0f`, using entirely synthetic
login-session fields and tenant ID `synthetic-tenant`. The actual base http/auth/session modules
were loaded with Node TypeScript stripping, after rewriting only their import specifiers to
relative paths in an isolated temporary directory. A Map-backed sessionStorage captured the
writer output; it was not manually assembled to match the extracted reader.

The input had lastActivityAt `2026-03-28T18:00:00.000Z`, idleExpiresAt
`2026-03-28T19:00:00.000Z` and sessionPolicy maxLifetime `8h`, which the base writer intentionally
omits. Every other input field is visible in the persisted fixture. Authentication and status
were active, and all principal IDs and token strings are synthetic. The tests pin the original
key and deep equality of the read result, and run the synthetic-data validator on this fixture.
