-- DocumentDB extension bootstrap (add-ferretdb-documentdb-engine).
-- Run by the postgres entrypoint from docker-entrypoint-initdb.d on first init, against
-- POSTGRES_DB (falcone_test). Mirrors the Helm init Job
-- (charts/in-falcone/templates/documentdb-init-job.yaml). CASCADE pulls in documentdb_core.
-- Requires the pg_documentdb library to be preloaded (shared_preload_libraries), which the
-- engine image provides by default.
CREATE EXTENSION IF NOT EXISTS documentdb CASCADE;
