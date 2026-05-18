## 1. Failing tests

- [ ] 1.1 [test] Add `services/secret-audit-handler/test/tail.test.mjs`
      cases: (a) write 5 lines, start tailer, observe 5 yields; write 3
      more lines after start, observe 3 additional yields, proving B1
      from `vault-log-reader.mjs:39-48`.
- [ ] 1.2 [test] Add a case asserting the tailer resumes at the
      persisted byte-offset across restart: write 10 lines, consume,
      checkpoint, restart tailer, write 5 more lines, observe only 5
      yields (not 15), proving B2.
- [ ] 1.3 [test] Add a case asserting a malformed JSON line is routed
      to the parse-error handler (counter increment + DLQ topic) and
      the for-await continues with the next line, proving B3 from
      `vault-log-reader.mjs:6` + `index.mjs:31-34`.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/secret-audit-handler/src/checkpoint.mjs`
      with `loadCheckpoint()` and `saveCheckpoint({byteOffset, inode,
      lastVaultRequestId})`; default path
      `/var/lib/secret-audit-handler/checkpoint.json`.
- [ ] 2.2 [fix] Rewrite `createLogTailer` at
      `vault-log-reader.mjs:39-48` to: load checkpoint, open at
      `byteOffset`, stream-read new bytes on a poll loop, split lines,
      yield entries, persist checkpoint after each yield. Detect inode
      change for log-rotation and reopen at byte 0.
- [ ] 2.3 [impl] Add
      `services/secret-audit-handler/src/parse-error-handler.mjs`
      exposing `handleParseError(line, error)` that increments the
      `vault_audit_parse_errors_total` counter and publishes the raw
      line + error reason to `audit.dlq.secret-audit`.
- [ ] 2.4 [fix] In `index.mjs:31-34`, wrap the for-await body in a
      try/catch routing parse errors through `handleParseError`;
      continue the loop on parse failure.
- [ ] 2.5 [migration] Document the checkpoint path and DLQ topic in
      `services/secret-audit-handler/README.md`; add a Helm-chart note
      so deployments mount the writable volume.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/secret-audit-handler test`
      and `openspec validate complete-m2-tail-and-checkpoint --strict`;
      both green.
