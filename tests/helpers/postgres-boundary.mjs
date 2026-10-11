// Mock only the Postgres driver boundary; dispatchers, actions, auth and replay stay real.
let database;
export function setDatabase(value) { database = value; }
export default { Pool: class {
  query(...args) { return database.query(...args); }
  async connect() { return { query: (...args) => database.query(...args), release() {} }; }
  async end() {}
} };
