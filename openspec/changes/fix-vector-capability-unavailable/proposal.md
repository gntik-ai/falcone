# Fail closed when workspace vector capability is unavailable

## Why

Issue #983: workspace connections resolve to the singleton Postgres instance. Deploying a separate pgvector instance does not route workspace requests to it. Tenant vector calls currently execute unsupported SQL and receive generic database errors.

## What changes

- Probe `pg_available_extensions` on the resolved workspace client before KNN, vector column/table/index DDL (including previews), vector-index deletion, embedding-mapping writes, and auto-embedding writes targeting vector columns.
- Return HTTP 501 with the existing error envelope's `code`, `message`, and a `capability` field: `CAPABILITY_UNAVAILABLE`, a fixed tenant-safe message, and `vector_search`.
- Cache only successful probes for sixty seconds per registry and resolved host:port. Never cache absence, credentials, or full DSNs. Requests recover immediately after an operator makes vector available.
- Map vector-related SQLSTATE 42704/42883 execution errors to the same envelope. Preserve unrelated errors and fail closed on probe errors. Plain CRUD, plain index DDL, and mapping reads do not probe.
- Extract the unchanged catalog helper into internal-contracts and preserve the provisioning applier's existing export and behavior. Ship both shared helpers in the workflow worker, which also imports the data executor.

No routing, schema migration, runtime environment variable, credential wiring, gateway, UI, or workflow pin changes are included. The separate deployment maker owns the comment-only chart corrections and manifest parity checks. Rollback is an executor/worker image revert with no data migration.

## Test seams and confirmed cause

The tenant HTTP request listener is the regression seam: real dispatch, authorization, adapters, executors, and error serialization execute against a substituted database I/O boundary. A second seam loads the capability module from the files shipped by each Dockerfile. The real-stack negative case uses the actual HTTP server and connection registry against plain Postgres via the existing fixture settings.

Before editing runtime source, ran `node --test --experimental-test-isolation=none tests/unit/vector-capability-unavailable.test.mjs` twice. The minimal request reached the actual KNN SQL path, raised undefined-vector SQLSTATE 42704, and returned `400 SYNTAX_OR_ACCESS` instead of the specified capability error. Confirmed cause: missing availability preflight, followed by generic undefined-type/operator error mapping. The same command now passes. Each subsequent source slice was preceded by a failing regression for that behavior.

Packaging verification also went red before extraction/worker packaging changes: the provisioning applier is absent from the executor image, and the new runtime helper was initially absent from the worker image. The image-file import regressions now pass without installing dependencies or fetching images.
