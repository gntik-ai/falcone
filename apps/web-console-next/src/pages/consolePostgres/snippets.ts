// Client-only templates copied from the legacy postgres-database catalog.
export const snippetTemplates = [
  "postgresql://<PG_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_NAME}?sslmode=require",
  "import { Client } from 'pg'\n\nconst client = new Client({\n  host: '{HOST}',\n  port: {PORT},\n  database: '{RESOURCE_NAME}',\n  user: '<PG_USER>',\n  password: '{PASSWORD}',\n  ssl: true\n})\n\nawait client.connect()\nconst result = await client.query('select now()')\nconsole.log(result.rows[0])\nawait client.end()",
  "import psycopg2\n\nconn = psycopg2.connect(\n    host='{HOST}',\n    port={PORT},\n    dbname='{RESOURCE_NAME}',\n    user='<PG_USER>',\n    password='{PASSWORD}',\n    sslmode='require'\n)\n\nwith conn.cursor() as cur:\n    cur.execute('select current_schema()')\n    print(cur.fetchone())\n\nconn.close()"
]
