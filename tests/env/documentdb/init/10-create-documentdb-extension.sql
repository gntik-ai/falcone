-- DocumentDB extension bootstrap (add-ferretdb-documentdb-engine).
-- Run by the postgres entrypoint from docker-entrypoint-initdb.d on first init (against
-- POSTGRES_DB=falcone_test). Mirrors the Helm init Job
-- (charts/in-falcone/templates/documentdb-init-job.yaml). CASCADE pulls in documentdb_core.
--
-- The extension MUST be created in the `postgres` database, NOT falcone_test: pg_documentdb
-- cascades pg_cron, and pg_cron is bound to cron.database_name='postgres' (custom.conf), so
-- `CREATE EXTENSION documentdb` only succeeds in `postgres` ("can only create extension in
-- database postgres"). FerretDB connects to `postgres`. Switch databases before creating it.
\connect postgres
CREATE EXTENSION IF NOT EXISTS documentdb CASCADE;
