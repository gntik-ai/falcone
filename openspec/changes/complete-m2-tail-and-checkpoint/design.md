## Goals

1. The handler streams every line Vault writes to its audit log to Kafka,
   in order, exactly once per restart cycle (modulo Kafka's at-least-once
   semantics).
2. Process restarts resume at the last successfully-published byte; the
   historical log is not re-published.
3. A malformed line is observable (metric + DLQ) but does not crash the
   process.
4. Log rotation (Vault rolls the file) is detected and handled without
   data loss or duplicate publication.

## Non-goals

- **Reading Vault's WAL or replication stream.** Audit log is the
  intended interface per the README and the YAML contract; we keep it.
- **Implementing canonical-envelope conformance** (covered by
  `fix-m2-event-schema-validation` and the M1 envelope work).
- **Switching transport from KafkaJS.**
- **Cluster-wide deduplication.** Idempotent producer + checkpoint give
  exactly-once-per-restart; cross-instance dedup is a future concern.

## Tail loop architecture

```
loadCheckpoint() → {byteOffset, inode, lastVaultRequestId}
loop forever:
  stat = fs.stat(filePath)
  if stat.ino !== checkpoint.inode:
    // log was rotated
    process rotated file from checkpoint.byteOffset to its EOF
    saveCheckpoint({byteOffset: 0, inode: stat.ino, lastVaultRequestId})
    continue
  if stat.size > checkpoint.byteOffset:
    stream = fs.createReadStream(filePath, {start: checkpoint.byteOffset, end: stat.size - 1})
    rl = readline.createInterface({input: stream, crlfDelay: Infinity})
    for await line of rl:
      yield parseVaultEntry(line)  // or route to DLQ via try/catch
      saveCheckpoint({byteOffset: streamBytesRead, inode, lastVaultRequestId: entry.eventId})
  await sleep(VAULT_AUDIT_POLL_INTERVAL_MS ?? 1000)
```

Polling is preferred over `fs.watch` because `fs.watch` is unreliable
across mount types (NFS, k8s persistent volumes); a 1s poll is both
adequate for an audit pipeline and portable.

## Checkpoint format

A JSON file at `VAULT_AUDIT_CHECKPOINT_PATH` (default
`/var/lib/secret-audit-handler/checkpoint.json`):

```json
{
  "filePath": "/vault/audit/vault-audit.log",
  "byteOffset": 12345,
  "inode": 9876543,
  "lastVaultRequestId": "uuid-...",
  "savedAt": "2026-05-18T12:00:00.000Z"
}
```

Persistence happens after every successful `publishAuditEvent` call.
Persistence is synchronous (`writeFileSync`) to ensure the checkpoint
is durable before the next yield — a crash between publish and
checkpoint causes one duplicate publish on restart, which is acceptable
under at-least-once semantics.

## Log rotation handling

Vault rotates its audit log on size or operator signal. The handler
detects rotation by comparing `stat.ino` between iterations; on
mismatch, the prior file is read to its EOF (capturing late writes), a
fresh checkpoint is written with `byteOffset: 0` and the new inode, and
the loop continues against the new file.

## Parse-error DLQ

A malformed line publishes `{raw_line, parse_error, timestamp,
checkpoint}` to topic `audit.dlq.secret-audit`. Operators inspect the
DLQ to triage; the main loop continues. A repeat-flood from a corrupted
file is bounded by Vault's own write rate.

## Out-of-scope notes

This change does not address the topic-naming or partitioning issues
(separate proposal). It does not address Kafka send-failure swallowing
or eventId/vaultRequestId binding (separate proposal). It also does
not introduce concurrent publication — sequential awaits are kept;
back-pressure is a follow-up under `harden-m2-runtime-operations`.
