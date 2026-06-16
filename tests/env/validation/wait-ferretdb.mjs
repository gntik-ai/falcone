#!/usr/bin/env node
// Poll the FerretDB gateway wire protocol until it answers a MongoDB ping (engine-first
// startup gate; change add-ferretdb-migration-validation, task 3b.1). The ferretdb:2.7.0 image
// is DISTROLESS, so a docker-compose CMD healthcheck cannot run — readiness is gated here, on
// the host side, after the documentdb engine is already healthy. Exits 0 when the gateway
// answers, non-zero on timeout so run-ferretdb-validation.sh can abort and name the container.
import { MongoClient } from 'mongodb';

const URI = process.env.FERRETDB_URI ?? process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/';
const DEADLINE_MS = Number(process.env.FERRETDB_WAIT_MS ?? 60000);
const start = Date.now();
let lastErr;

while (Date.now() - start < DEADLINE_MS) {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 2000 });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    await client.close();
    console.error(`FerretDB gateway ready after ${Date.now() - start}ms`);
    process.exit(0);
  } catch (e) {
    lastErr = e;
    await client.close().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

console.error(`FerretDB gateway not ready after ${DEADLINE_MS}ms: ${lastErr?.message ?? 'unknown error'}`);
process.exit(1);
