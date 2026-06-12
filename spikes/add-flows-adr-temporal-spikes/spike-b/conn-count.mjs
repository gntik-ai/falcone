// EPHEMERAL SPIKE — not production code.
// Counts established outbound gRPC connections from a process to the Temporal frontend port
// (7233) by parsing /proc/<pid>/net/tcp (and tcp6). Linux-only; the spike runs on Linux.
import { readFileSync, existsSync } from 'node:fs';

const FRONTEND_PORT = 7233;
const PORT_HEX = FRONTEND_PORT.toString(16).toUpperCase().padStart(4, '0'); // 1C41
const TCP_ESTABLISHED = '01'; // st field

function parseTcpTable(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').slice(1);
  const rows = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const remote = cols[2]; // addr:port hex
    const st = cols[3];
    const port = remote.split(':')[1];
    rows.push({ remotePortHex: port, state: st });
  }
  return rows;
}

// Connections from <pid> to 127.0.0.1:7233 in ESTABLISHED state.
export function countGrpcConnections(pid) {
  const tables = [`/proc/${pid}/net/tcp`, `/proc/${pid}/net/tcp6`];
  let n = 0;
  for (const t of tables) {
    for (const row of parseTcpTable(t)) {
      if (row.remotePortHex === PORT_HEX && row.state === TCP_ESTABLISHED) n += 1;
    }
  }
  return n;
}
