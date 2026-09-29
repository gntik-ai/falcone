## Source

- [x] Commit definition mutations and outbox records atomically.
- [x] Add a replica-safe Kafka relay with stable event keys, retry cap, dead letters, and metrics.
- [x] Propagate request correlation IDs and update Flow audit documentation.
- [ ] Run black-box and real PostgreSQL integration tests in PR CI after dependency installation.

## Deployment and release gate

- [ ] Provision the platform audit topic and producer ACL in falcone-charts using the deterministic Helm adapter.
- [ ] Render base and staging Helm values and verify pinned image digests.
- [ ] After R3 approval, verify a real staging Flow journey and inspect redacted broker failure class if delivery fails.
- [ ] Document the pre-fix audit gap and inspect any old tenant namespace audit topic for stale records.
