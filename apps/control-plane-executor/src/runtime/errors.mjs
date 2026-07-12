// Shared error helpers for the control-plane executor (sanitized client errors +
// Postgres error-code mapping). Used by the data and DDL executors.

export function clientError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// Map a raw Postgres driver error to a sanitized client error. Never surfaces the
// pg message/detail/hint or the SQL text — only a stable code + a generic message.
// Codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
export function mapPgError(error) {
  const pgCode = error?.code;
  if (typeof pgCode === 'string') {
    switch (pgCode) {
      case '23505': return clientError('Unique constraint violation', 409, 'UNIQUE_VIOLATION');
      case '23503': return clientError('Foreign key violation', 422, 'FOREIGN_KEY_VIOLATION');
      case '23502': return clientError('Not-null constraint violation', 400, 'NOT_NULL_VIOLATION');
      case '23514': return clientError('Check constraint violation', 400, 'CHECK_VIOLATION');
      case '42501': return clientError('Insufficient privilege', 403, 'INSUFFICIENT_PRIVILEGE');
      case '42703': return clientError('Unknown column', 400, 'UNDEFINED_COLUMN');
      case '42P01': return clientError('Table not found', 404, 'TABLE_NOT_FOUND');
      case '42P06': return clientError('Schema already exists', 409, 'DUPLICATE_SCHEMA');
      case '42P07': return clientError('Relation already exists', 409, 'DUPLICATE_TABLE');
      case '42710': return clientError('Object already exists', 409, 'DUPLICATE_OBJECT');
      default: break;
    }
    if (pgCode.startsWith('22')) return clientError('Invalid data value', 400, 'DATA_EXCEPTION');
    if (pgCode.startsWith('42')) return clientError('Invalid statement', 400, 'SYNTAX_OR_ACCESS');
    if (pgCode.startsWith('08')) return clientError('Database connection error', 503, 'DB_CONNECTION_ERROR');
    if (pgCode.startsWith('57')) return clientError('Database unavailable', 503, 'DB_UNAVAILABLE');
  }
  // Unknown/internal: opaque 500 (the caller logs the original server-side).
  return Object.assign(new Error('Internal server error'), { statusCode: 500, code: 'INTERNAL_ERROR', cause: error });
}
