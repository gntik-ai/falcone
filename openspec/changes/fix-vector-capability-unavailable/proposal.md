# Fail closed when workspace vector capability is unavailable

## Why

Issue #983: workspace connections resolve to the singleton Postgres instance. Deploying a separate pgvector instance does not route workspace requests to it. Tenant vector calls currently execute unsupported SQL and receive generic database errors.

## What changes

- Probe `pg_available_extensions` on the resolved workspace client before KNN, vector column/table/index DDL execution, vector-index deletion, embedding-mapping writes, and auto-embedding writes targeting vector columns. DDL previews remain in-memory plans without resolving or probing a database, including empty plans.
- Return HTTP 501 with the existing error envelope's `code`, `message`, and a `capability` field: `CAPABILITY_UNAVAILABLE`, a fixed tenant-safe message, and `vector_search`.
- Cache only successful probes for sixty seconds per registry and resolved host:port. Never cache absence, credentials, or full DSNs. Requests recover immediately after an operator makes vector available.
- Map SQLSTATE 42704/42883 messages for missing vector types, operators, operator classes, functions, or hnsw/ivfflat access methods to the same envelope. Missing tenant indexes or other objects merely named `vector` or `vector_*` retain their existing errors. Preserve unrelated errors and fail closed on probe errors. Plain CRUD, plain index DDL, and mapping reads do not probe.
- Extract the unchanged catalog helper into internal-contracts and preserve the provisioning applier's existing export and behavior. Ship both shared helpers in the workflow worker, which also imports the data executor.

No routing, schema migration, runtime environment variable, credential wiring, gateway, UI, or workflow pin changes are included. The separate deployment maker owns the comment-only chart corrections and manifest parity checks. Rollback is an executor/worker image revert with no data migration.

## Test seams and confirmed cause

The tenant HTTP request listener is the regression seam: real dispatch, authorization, adapters, executors, and error serialization execute against a substituted database I/O boundary. A second seam loads the capability module from the files shipped by each Dockerfile. The real-stack negative case uses the actual HTTP server and connection registry against plain Postgres via the existing fixture settings.

Before editing runtime source, ran `node --test --experimental-test-isolation=none tests/unit/vector-capability-unavailable.test.mjs` twice. The minimal request reached the actual KNN SQL path, raised undefined-vector SQLSTATE 42704, and returned `400 SYNTAX_OR_ACCESS` instead of the specified capability error. Confirmed cause: missing availability preflight, followed by generic undefined-type/operator error mapping. The same command now passes. Each subsequent source slice was preceded by a failing regression for that behavior.

Packaging verification also went red before extraction/worker packaging changes: the provisioning applier is absent from the executor image, and the new runtime helper was initially absent from the worker image. The image-file import regressions now pass without installing dependencies or fetching images.

## Follow-up checker findings

The HTTP-listener regression `node --test --experimental-test-isolation=none --test-name-pattern='missing tenant objects' tests/unit/vector-capability-unavailable.test.mjs` failed twice before the follow-up fix: deleting a missing `vector_idx` returned 501 instead of 400. Ranked hypotheses were an overbroad backstop matcher, unconditional vector-route error replacement, and a changed generic Postgres mapper. A REPL probe showed that the generic mapper still returns `SYNTAX_OR_ACCESS` while the backstop returns `CAPABILITY_UNAVAILABLE` for that same missing-index error, confirming the matcher as the cause. Narrow missing-object message patterns now preserve errors for tenant identifiers at both DELETE-vector-index and KNN seams. Error selection is shared by data, DDL, and mapping handlers without changing their fallback conventions.

Separate red-to-green regressions cover missing hnsw/ivfflat access methods and database-independent previews. Preview generation again precedes all database access and the execute-mode no-op return.

Mapping PUT and DELETE intentionally remain fail-closed writes under the acceptance criteria, including deletion of stale mappings; GET remains usable. Writes probe the existing resolved workspace connection, including the resolver's existing shared-database fallback, without introducing routing or dedicated-database prerequisites for metadata writes. An unresolved connection retains its existing upstream error before metadata changes. Tests verify both metadata preservation on blocked deletion and unresolved-workspace behavior. Executed DDL continues to require a dedicated database.
