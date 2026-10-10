// pg_available_extensions describes the extension control files shipped by this
// instance, independently of whether an extension is installed in this database.
// Query failures propagate; they must never be treated as extension absence.
export async function checkPostgresExtensionAvailable(name, query) {
  const rows = await query('SELECT 1 FROM pg_available_extensions WHERE name = $1', [name]);
  return Array.isArray(rows) && rows.length > 0;
}
