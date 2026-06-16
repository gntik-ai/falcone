# Third-party software & licenses

In Falcone itself is **MIT-licensed** (see [`LICENSE`](https://github.com/gntik-ai/falcone/blob/main/LICENSE)).
It builds on the third-party software below. Components marked ⚠ are **copyleft or
source-available** (not OSI open source) — see [License compatibility](#license-compatibility).

Licenses were verified from each package's own metadata / repository, not from memory. For the
complete dependency tree (beyond the principal components listed here) see
[Completeness & SBOM](#completeness-sbom).

## Platform & infrastructure

Deployed as separate services / container images that In Falcone talks to over the network.

| Component | Role in In Falcone | License (SPDX) | Link |
| --- | --- | --- | --- |
| PostgreSQL 16 (+ pgvector) | Primary tenant datastore; RLS + schema-per-tenant isolation; pgvector for vector search | `PostgreSQL` | [postgresql.org](https://www.postgresql.org/about/licence/) · [pgvector](https://github.com/pgvector/pgvector) |
| FerretDB v2 (over DocumentDB / PostgreSQL 17) | Document data API — MongoDB-wire-compatible ([ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)) | `Apache-2.0` (gateway) + `MIT` (DocumentDB extension) | [ferretdb](https://github.com/FerretDB/FerretDB) · [documentdb](https://github.com/microsoft/documentdb) |
| Redpanda 24.2 | Kafka-compatible event bus / CDC streaming | ⚠ `BSL-1.1` (Redpanda) + `RCL` | [licenses](https://github.com/redpanda-data/redpanda/tree/dev/licenses) |
| SeaweedFS 4.33 | S3-compatible object storage ([ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs)) | `Apache-2.0` | [seaweedfs](https://github.com/seaweedfs/seaweedfs) |
| HashiCorp Vault 1.18 | Secrets management | ⚠ `BUSL-1.1` | [LICENSE](https://github.com/hashicorp/vault/blob/main/LICENSE) |
| Keycloak 26 | Realm-per-tenant IAM / OIDC | `Apache-2.0` | [keycloak](https://github.com/keycloak/keycloak) |
| Apache APISIX 3.9 | API gateway (public `/v1` surface) | `Apache-2.0` | [apisix](https://github.com/apache/apisix) |
| Temporal (server 1.25 + TypeScript SDK 1.18) | Durable workflow engine behind Flows | `MIT` | [temporal](https://github.com/temporalio/temporal) · [sdk-typescript](https://github.com/temporalio/sdk-typescript) |
| Knative Serving + Kourier | Serverless functions runtime | `Apache-2.0` | [serving](https://github.com/knative/serving) · [net-kourier](https://github.com/knative-extensions/net-kourier) |
| Kubernetes + Helm | Deployment & orchestration | `Apache-2.0` | [kubernetes](https://github.com/kubernetes/kubernetes) · [helm](https://github.com/helm/helm) |
| Node.js 22 | Service runtime | `MIT` | [nodejs](https://github.com/nodejs/node) |
| nginx | Static serving of the web-console image | `BSD-2-Clause` | [nginx.org](https://nginx.org/LICENSE) |

## Application frameworks & libraries (npm)

| Component | Role in In Falcone | License (SPDX) | Link |
| --- | --- | --- | --- |
| React 18 | Web console UI | `MIT` | [react](https://github.com/facebook/react) |
| Vite | Console build & dev server | `MIT` | [vite](https://github.com/vitejs/vite) |
| TypeScript | Typed source (console, workflow worker) | `Apache-2.0` | [TypeScript](https://github.com/microsoft/TypeScript) |
| Tailwind CSS | Console styling | `MIT` | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| React Flow (`@xyflow/react`) | Visual Flows designer canvas | `MIT` | [xyflow](https://github.com/xyflow/xyflow) |
| Monaco Editor (+ `monaco-yaml`) | In-console code / YAML editing | `MIT` | [monaco-editor](https://github.com/microsoft/monaco-editor) |
| node-postgres (`pg`) | PostgreSQL client | `MIT` | [node-postgres](https://github.com/brianc/node-postgres) |
| MongoDB Node Driver (`mongodb`) | Document-store client — MongoDB wire protocol (MongoDB / FerretDB) | `Apache-2.0` | [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) |
| KafkaJS | Kafka / Redpanda client | `MIT` | [kafkajs](https://github.com/tulios/kafkajs) |
| AWS SDK for JS v3 (`@aws-sdk/client-s3`) | S3 object-store client (SeaweedFS) | `Apache-2.0` | [aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| jose + jwks-rsa | JWT / JWKS validation | `MIT` | [jose](https://github.com/panva/jose) · [node-jwks-rsa](https://github.com/auth0/node-jwks-rsa) |
| ws | WebSocket realtime gateway | `MIT` | [ws](https://github.com/websockets/ws) |
| Ajv | JSON Schema validation | `MIT` | [ajv](https://github.com/ajv-validator/ajv) |
| cel-js | Capability / policy expression evaluation | `MIT` | [cel-js](https://www.npmjs.com/package/cel-js) |
| Playwright | Real-stack E2E tests | `Apache-2.0` | [playwright](https://github.com/microsoft/playwright) |

## License compatibility

::: warning Review before any hosted or commercial offering
In Falcone's own code is **MIT**, which is compatible with consuming all the permissive
components above (MIT, Apache-2.0, ISC, BSD, PostgreSQL). The ⚠ components are **not** OSI open
source and deserve review:

- **Redpanda (`BSL-1.1` + `RCL`)** and **Vault (`BUSL-1.1`)** are copyleft or source-available. The
  former **MongoDB (`SSPL-1.0`)** and **MinIO (`AGPL-3.0`)** dependencies have been **removed** —
  replaced by **FerretDB** (`Apache-2.0`, [ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb))
  and **SeaweedFS** (`Apache-2.0`, [ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs))
  respectively, retiring their SSPL/AGPL exposure.
- Running them as **separate backing services In Falcone talks to over the network** does not, by
  itself, impose their license on In Falcone's MIT code (no linking / derivative work). **But**
  their "offer-as-a-service" / "competitive service" clauses are directly relevant to a
  multi-tenant BaaS that **re-exposes** their functionality to tenants — a Mongo data API, a
  Kafka/events API, an S3 storage API. In particular, **SSPL §13 and AGPL §13 target offering the
  software's functionality as a service**, and the Redpanda / Vault BSL grants exclude competing
  managed offerings. Review these terms before any hosted or commercial offering. All four are
  swappable at the deployment layer if their terms don't fit your use.
- **Object store: MinIO → SeaweedFS (Apache-2.0).** Per
  [ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs), **SeaweedFS** is
  the object store, chosen specifically to retire the MinIO **AGPL §13** "offer-as-a-service"
  exposure for a BaaS that re-exposes S3 to tenants. The former MinIO dependency has been removed.
- **Document store: MongoDB → FerretDB + DocumentDB (Apache-2.0 + MIT).** Per
  [ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb),
  **FerretDB v2** over a DocumentDB / PostgreSQL engine is the document store, chosen specifically to
  retire the MongoDB **SSPL §13** "offer-as-a-service" exposure for a BaaS that re-exposes the
  document-store wire protocol to tenants. FerretDB keeps the MongoDB driver and wire protocol
  unchanged; the former MongoDB server dependency has been removed.

This is engineering guidance, not legal advice — have counsel review before distribution.
:::

## Completeness & SBOM

This page lists the **principal** third-party components, not the full transitive dependency tree
(minor utilities — `undici`, `clsx`, `lucide-react`, `uuid`, `cron-parser`, `js-yaml`, etc. — are
omitted). For the complete picture, generate a license report from the monorepo:

```bash
pnpm sbom:licenses        # human-readable table of every dependency's license
pnpm sbom:licenses:json   # machine-readable JSON, keyed by SPDX identifier
```

CI also produces this report on every run — the **`third-party-license-report`** artifact of the
`security` job in [`.github/workflows/ci.yml`](https://github.com/gntik-ai/falcone/blob/main/.github/workflows/ci.yml).
If Python or Go components are added later, complement it with `pip-licenses` and `go-licenses`
respectively, and review the output before distribution.
