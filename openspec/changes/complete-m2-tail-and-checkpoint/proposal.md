## Why

The Vault audit-handler service does not do its job — the "tailer" reads
the file once and idles, every restart floods Kafka with the entire
historical log, and one malformed line crashes the process. From
`openspec/audit/cap-m2-secret-audit-pipeline.md`:

- **B1** (`services/secret-audit-handler/src/vault-log-reader.mjs:39-48`)
  — `createLogTailer` opens `fs.createReadStream`, drains via `readline`,
  then calls `fs.watch(filePath, () => undefined)` (a no-op watcher that
  is never awaited) and returns from the generator. New lines written by
  Vault after EOF are never read.
- **B2** (same `:39-48`) — `fs.createReadStream` starts at byte 0; no
  checkpoint. On every process restart the entire Vault audit log is
  re-published to Kafka.
- **B3** (`vault-log-reader.mjs:6` + `src/index.mjs:31-34`) —
  `parseVaultEntry` calls `JSON.parse(line)` with no try/catch; the
  bootstrap `for await` does not catch either. A single malformed line
  crashes the entire process — combined with B2, the restart-and-replay
  cycle produces unbounded duplicates.
- **G1** — there is no real tail loop (no `chokidar`, no poll-and-seek,
  no `inotify`).
- **G2** — there is no offset persistence (no `last_request_id` or
  byte-offset checkpoint file).
- **G8** — no DLQ / poison-message routing for un-parseable lines.

## What Changes

- Replace `createLogTailer` with a real tail implementation: poll the
  file's `stat.size`, seek to the persisted byte-offset, stream new
  bytes, line-split, and yield parsed entries. Handle log rotation by
  detecting inode change (`stat.ino`) and re-opening at byte 0 with a
  fresh checkpoint.
- Persist `{filePath, byteOffset, inode, lastVaultRequestId}` to a
  checkpoint file (default `${VAULT_AUDIT_CHECKPOINT_PATH}` or
  `/var/lib/secret-audit-handler/checkpoint.json`); update after each
  successful Kafka publish.
- Wrap `parseVaultEntry` in a per-line try/catch at the `for await`
  level; malformed lines route to a counter metric
  (`vault_audit_parse_errors_total`) and a DLQ topic
  (`audit.dlq.secret-audit`), and processing continues.

## Capabilities

### Modified Capabilities

- `secret-management`: Vault-audit tail loop, byte-offset checkpoint,
  log-rotation handling, and parse-error DLQ.

## Impact

- **Affected code**: `services/secret-audit-handler/src/vault-log-reader.mjs`,
  `services/secret-audit-handler/src/index.mjs`, new
  `services/secret-audit-handler/src/checkpoint.mjs`,
  `services/secret-audit-handler/src/parse-error-handler.mjs`.
- **Migration required**: deploy must mount a writable directory at the
  checkpoint path; Kafka topic `audit.dlq.secret-audit` must exist.
- **Breaking changes**: the first run after deploy will start from the
  current EOF position (not byte 0) so the historical replay is
  avoided; operators wanting a historical backfill must explicitly
  clear the checkpoint file.
- **Out of scope**: switching to the canonical
  `audit.<tenant_id>` topic (covered by
  `fix-m2-topic-and-partitioning-alignment`); fixing schema
  enforcement (covered by `fix-m2-event-schema-validation`).
