# Migration dry-run results — tests/env (Docker Compose)

- **Environment:** tests/env Docker Compose — source `mongo:7` (container `migsrc`) → target FerretDB
  `ghcr.io/ferretdb/ferretdb:2.7.0` over `postgres-documentdb:17-0.107.0-ferretdb-2.7.0` (port 57017).
- **Executed (UTC):** 20260616T054329Z
- **Scope:** `shop` database (`orders`, `products`) — covering single/compound/unique/sparse/TTL/text/2dsphere indexes and mixed BSON number types.

## Per-step outcomes

| Step | Tool | Outcome |
|------|------|---------|
| 1. Preflight | `preflight.sh` | PASS — gateway reachable (ferretdb v2.7.0, wire 7.0.77); version pair confirmed |
| 2. Pre-copy snapshot (source) | `snapshot.sh` | PASS — `pre-20260616T054329Z.json` |
| 3. Bulk copy | `bulk-copy.sh` (mongodump) | PASS |
| 4. Idempotent upsert | `upsert.sh` | PASS — 2 collection(s) |
| 5. Index recreate | `recreate-indexes.sh` | recreate-indexes: 4/4 |
| 6. Post-copy snapshot (target) | `snapshot.sh` | PASS — `post-20260616T054329Z.json` |
| 7. Parity compare | `compare-snapshots.sh` | compare-snapshots: 2/2 collection(s) match |

## Snapshot digests (sha256 of the snapshot files)

- pre  (source): `562280a00c24a9c0058a31123e1885e7b423a4c7c6b44c88e35ebfc8618282b2`
- post (target): `562280a00c24a9c0058a31123e1885e7b423a4c7c6b44c88e35ebfc8618282b2`

## Integrity comparison (source vs target)

```
OK shop.orders (count=2, checksum match)
OK shop.products (count=1, checksum match)
>> compare-snapshots: 2/2 collection(s) match
```

Per-collection (engine-agnostic sha256 over _id-sorted canonical documents):

- `shop.orders`: count=2 checksum=67e41ee38d882d4a… (source==target: True)
- `shop.products`: count=1 checksum=e17278e97a999114… (source==target: True)

## Index recreation (per index)

```
PASS: index t_1 on shop.orders
PASS: index uq_amt on shop.orders
PASS: index desc_text on shop.products
PASS: index loc_2dsphere on shop.products
```

## Notes

- All applies are idempotent `replaceOne({_id}, doc, {upsert:true})`; re-running converges with stable counts (verified separately in delta mode).
- `text`/`2dsphere` index version metadata (`textIndexVersion:3`, `2dsphereIndexVersion:3`) is stripped on recreate — FerretDB 2.7.0 supports text v2 only.
- Realtime/CDC remain non-functional on FerretDB (change streams unsupported) — out of scope; see `add-ferretdb-realtime-cdc-remediation` (#460).
