# SeaweedFS spike findings — filer-on-PostgreSQL, port, identities

**OpenSpec change:** `add-seaweedfs-storage-adr-spike` · **GitHub:** #431 · SeaweedFS **4.33**
(`chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495`).

Companion to `compatibility-matrix.md`. Evidence under `evidence/`.

## S3 gateway port (task 1.2)
**8333 — confirmed** (expected value held). Startup line: `Start Seaweed S3 API Server 30GB 4.33 …
at http port 8333` (`evidence/02-s3-gateway-startup-port.txt`). Companion ports observed: filer 8888,
master 9333, volume 8080, and an **Iceberg REST catalog on 8181** (new surface, not used by Falcone —
flag for the deployment change to leave unexposed).

## Filer-on-PostgreSQL (tasks 2.1–2.5)

**Result: VALIDATED** with one required config correction.

- **postgres2 needs an explicit `createTable` template.** Booting with `[postgres2] enabled=true` and
  no `createTable` crashes the filer: `init table filemeta: ERROR: syntax error at or near "%!"`
  — SeaweedFS `fmt.Sprintf`'s an empty template, emitting literal `%!` into the DDL
  (`evidence/01-postgres2-default-createtable-failure.txt`). Fix applied in `conf/filer.toml`:
  ```toml
  createTable = """CREATE TABLE IF NOT EXISTS "%s" (
    dirhash BIGINT, name VARCHAR(65535), directory VARCHAR(65535), meta bytea,
    PRIMARY KEY (dirhash, name));"""
  ```
  → **deployment requirement** for `add-seaweedfs-deployment`.

- **Namespace-ops smoke passes** (`evidence/09-delete-cleanup.txt`): create bucket → write → read
  (content integrity ✓) → delete object (`KeyCount=0`) → delete bucket (`head_bucket → 404`).

- **Schema applied** (`evidence/08-postgres-filer-ddl.txt`):
  - **One table per bucket** under `postgres2`: `tenant-a-bucket`, `tenant-a-lock-bucket`, plus a root
    `filemeta`. Each table: `(dirhash bigint, name varchar(65535), directory varchar(65535),
    meta bytea, PRIMARY KEY (dirhash, name))`.
  - **No extensions required** beyond the default `plpgsql`. Compatible with a stock Falcone Postgres
    (14+). Tested against Postgres 16.
  - **Bucket lifecycle = table lifecycle**: deleting a bucket **DROPs** its table → no orphaned
    metadata (aligns with Falcone's cascading-cleanup requirement).

- **Coupling / risk — runtime DDL.** Because bucket name = PG table name, the filer's DB role must hold
  **CREATE/DROP TABLE at runtime** (not just DML), and bucket names are constrained by PG identifier
  rules (63-byte truncation — aligns with the S3 63-char bucket limit but worth a guard). SeaweedFS
  creates these tables **out-of-band** from Falcone's migration tooling. **Recommendation:** give
  SeaweedFS a **dedicated database** (the spike used `seaweedfs`), not Falcone's app DB, so its DDL
  never collides with managed migrations. This answers design Open Question #3: *do not* share the
  application DB — use a dedicated database (sharing a server/instance is fine).

## Per-tenant identities write/reload (tasks 7.1–7.4)

**Result: live reload VALIDATED — no gateway restart required.**

- **Static file (7.1):** `-s3.config=/conf/s3-identities.json` seeds identities at boot. The scoped
  `tenant-a` identity (`actions: ["Read:tenant-a-bucket","Write:…","List:…","Tagging:…"]`) signs S3
  requests against its own bucket (200) and is **denied** (`403 AccessDenied`) on another tenant's
  bucket (`evidence/05-bucket-management-matrix.json`).

- **Live reload via `s3.configure` (7.2):** `weed shell` → `s3.configure -user tenant-b -access_key …
  -secret_key … -buckets tenant-b-bucket -actions Read,Write,List -apply` adds a tenant **with no
  restart**; the running gateway accepts tenant-b's signature on the **first** attempt, and tenant-b
  is denied on tenant-a's bucket (`evidence/10-identities-live-reload.txt`). Static (`isStatic:true`)
  and dynamic (`isStatic:false`) identities coexist — static file = bootstrap seed, `s3.configure` =
  live per-tenant onboarding. This is exactly the model `provisioning-orchestrator` needs.

- **Fallback (7.4):** `s3.configure` is available and works live at 4.33, so the SIGHUP-+-file path is
  **not** required; it remains the documented fallback for static-only deployments. Provisioning model
  = **live reload** (no restart-per-tenant).

- **STS caveat:** the gateway logs `Failed to load IAM configuration: no signing key found for STS
  service` at boot (`evidence/02-…`). Static access/secret-key auth is unaffected (the path Falcone
  uses). If session tokens / AssumeRole are ever needed, set `jwt.filer_signing.key` /
  `security.toml`. Out of scope here; flagged for deployment hardening.

### Identity field mapping vs the provisioning code (task 7.3)

SeaweedFS identity entry → Falcone source of truth:

| SeaweedFS field | Falcone source | Status |
|---|---|---|
| `credentials[].accessKey` | `deriveAccessKeyId()` → `AKST…` (`services/adapters/src/storage-programmatic-credentials.mjs`) | **maps directly** |
| `credentials[].secretKey` | `deriveSecretAccessKey()` → `sk_…` (same file) | **maps directly** |
| `buckets` | tenant/workspace bucket names processed by `storage-applier.mjs` (`domainData.buckets[].name`) | **maps directly** |
| `actions` (`Read:bkt`/`Write:bkt`/`List:bkt`/`Tagging:bkt`) | Falcone *scopes* (`normalizeScope`) — **no SeaweedFS-action translation exists today** | **GAP → shim** |

**Key gap (confirms #433 is net-new):** `storage-applier.mjs` constructs **bucket-level** config
(name/versioning/lifecycle/policy/CORS) but never an **identity**; the synthetic `AKST…`/`sk_…`
credentials from `storage-programmatic-credentials.mjs` are **never written to any backend**
(`provisionWorkspaceStorageBoundary` is a `NOT_YET_IMPLEMENTED` stub). The per-tenant-identities child
must (a) translate Falcone scopes → SeaweedFS `actions` verbs, and (b) write the identity via
`s3.configure -apply` at provisioning time. The credential *shapes* are already compatible; only the
**actions mapping** and the **injection call** are new.
