// Shared test fixture: the two non-superuser, non-BYPASSRLS DB roles the data API resolves
// an api-key to (anon/service). Since fix-postgres-ddl-grants-and-rls (#494) every table
// created via the DDL API now GRANTs to these roles, so they are a SHARED fixture across the
// (concurrently-run) executor suite. Ensure-create them idempotently and race-safely — no
// DROP (dropping a role another concurrent file just granted to would orphan its grants and
// flake the suite). In production the chart/bootstrap creates these roles; here we mirror that.
const DATA_API_ROLES = ['falcone_service', 'falcone_anon'];

export async function ensureDataApiRoles(adminPool) {
  for (const role of DATA_API_ROLES) {
    // CREATE inside a DO with duplicate_object swallowed: atomic + safe under concurrent
    // creation by sibling test files (the loser of the race just no-ops).
    await adminPool.query(
      `DO $$ BEGIN CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    );
  }
}
