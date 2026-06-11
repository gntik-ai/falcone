# Backup & Restore

In Falcone supports **per-tenant** backup and restore across the tenant's resource domains: IAM, PostgreSQL metadata, MongoDB metadata, Kafka and object storage. The behaviour is exercised by the restore workflow suite (`tests/e2e/workflows/restore/`).

## Per-tenant artifact

A tenant backup is a multi-domain artifact. A restore can target all or a **subset** of domains:

| Domain | Contents |
| --- | --- |
| `iam` | Members, roles, service accounts |
| `postgres_metadata` | Relational schema/metadata |
| `mongo_metadata` | Document collections metadata |
| `kafka` | Topics / event config |
| `storage` | Object storage layout |

## Restore flows (verified by the suite)

- **Full restore on an empty tenant** — the golden path (`E1`).
- **Partial restore** — restore only selected domains, e.g. `iam + postgres_metadata`, or `kafka + storage` (`E2`).
- **Restore with conflicts** — e.g. an IAM role-name collision is detected and handled rather than silently overwriting (`E3`).
- **Degraded artifact** — a domain marked `not_available` (e.g. `mongo_metadata`) is handled without failing the whole restore (`E4`).
- **Format migration** — older artifact formats are migrated on restore (`E5`).

## Safety guarantees

The suite pins several operational invariants:

- **Tenant-ID mismatch** — restoring into a different tenant runs a **preflight** that proposes an identifier map; the restore only proceeds with that mapping, so resources are never silently grafted onto the wrong tenant (`EC2`).
- **Concurrent restore is blocked** — a second concurrent restore for the same tenant gets **`409 Conflict`** (`EC3`).
- **Partial failure & retry** — if one domain fails (e.g. Kafka), the operation can be retried to completion (`EC1`).
- **Max-size artifact** — large artifacts are handled without truncation or timeout (`EC4`).
- **Suspended tenant** — reprovision/restore on a suspended tenant is rejected or explicitly skipped (`EC5`).

## Running the restore workflow

```bash
npm run test:e2e:restore
```

This drives the restore behaviour against the workflow harness and can write a suite manifest report.

## Recommended practice

- Schedule per-tenant backups so each tenant can be restored independently — this is what keeps restore from being an all-or-nothing platform operation.
- Always restore through the preflight when the target tenant differs from the source, so identifiers are remapped rather than colliding.
- Treat the underlying backends (PostgreSQL, MongoDB, object storage, Kafka) with your standard infrastructure backup tooling in addition to the tenant-level artifact, for full disaster recovery.
