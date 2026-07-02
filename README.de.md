<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>Eine mandantenfähige (multitenant) Backend-as-a-Service (BaaS)-Plattform.</strong>

  <p>Datenbanken, Speicher, Authentifizierung, Events, Echtzeit und Serverless-Funktionen — pro Mandant isoliert, durch Pläne und Kontingente gesteuert, hinter einer einzigen API.</p>

  <p>
    <img alt="Status: frühe Entwicklung" src="https://img.shields.io/badge/status-early%20development-orange" />
    <img alt="Nicht produktionsbereit" src="https://img.shields.io/badge/production-not%20ready-critical" />
    <img alt="Lizenz: MIT" src="https://img.shields.io/badge/license-MIT-blue" />
  </p>

  <sub>

  [English](./README.md) ·
  [Español](./README.es.md) ·
  [Français](./README.fr.md) ·
  **Deutsch** ·
  [中文](./README.zh.md) ·
  [Русский](./README.ru.md)

  </sub>
</div>

---

> [!WARNING]
> **Falcone ist nicht produktionsreif.** Das Projekt befindet sich in früher, aktiver Entwicklung.
> Öffentliche APIs, Datenschemata und Laufzeitverhalten können sich jederzeit ändern — ohne
> Vorankündigung und ohne Migrationspfad. In diesem Stadium gibt es **keine Zusicherungen zu
> Stabilität, Sicherheit oder Support**, und das Projekt wurde keinem Sicherheitsaudit unterzogen.
> **Betreibe Falcone nicht für Produktionslasten und vertraue ihm keine sensiblen Daten an.** Nutze
> es ausschließlich zur Evaluierung, zum Experimentieren und zur Entwicklung.

---

## Das Prinzip hinter Falcone

Fast jedes Produkt braucht dieselbe Backend-Infrastruktur: eine Datenbank,
Dateispeicher, Benutzerauthentifizierung, Hintergrundjobs, einen Event-Bus,
Echtzeit-Updates. Diese Infrastruktur **einmal pro Anwendung — und erneut für
jeden Kunden —** zu bauen und zu betreiben, ist der Punkt, an dem Teams Zeit
verlieren und an dem Sicherheitsvorfälle entstehen.

Falcone gibt es, um das ein für alle Mal zu lösen. Es ist ein **mandantenfähiges
BaaS**: eine einzige Plattform, die viele isolierte Mandanten bedient, jeder mit
eigenen Daten, Identitäten und Ressourcen, bereitgestellt über eine konsistente
API.

Zwei Ideen halten das gesamte System zusammen:

1. **Mandanten-Isolation ist der Vertrag, kein Feature.**
   Jeder Lese- und Schreibvorgang ist durch `tenant_id` (und eine Ebene tiefer
   durch `workspace_id`) eingegrenzt. Die Identität wird am Rand aus einem Token
   aufgelöst, als expliziter Kontext durch das Gateway, die Services, die
   Datenschicht und die Hintergrundjobs weitergereicht und in der Datenbank über
   Row-Level-Security und Schemas pro Mandant durchgesetzt. Datenlecks zwischen
   Mandanten gelten als der kardinale Fehler.

2. **Fähigkeiten werden per Plan gewährt und überall durchgesetzt.**
   Was ein Mandant tun darf — SQL, Echtzeit, Webhooks, Funktionen, Kafka,
   Speicher — ist die Schnittmenge aus seinem **kommerziellen Plan**, dem
   **Deployment-Profil** und der **Umgebung**. Das Gateway sperrt Routen anhand
   dieser Capability-Keys, Kontingente begrenzen den Verbrauch pro
   Mandant/Workspace, und jede Ablehnung wird auditiert.

Das Ergebnis ist eine Plattform, auf der ein Kunde in Minuten ein vollständiges
Backend erhält, während der Betreiber eine einzige, steuerbare und beobachtbare
Oberfläche behält — statt einer Flotte handgebauter Backends.

### Wie alles zusammenpasst

```text
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API Gateway (APISIX)   /v1   Idempotenz, CORS,  │
                    löst Mandant auf ▸ injiziert Identität, Corr-ID │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 250+ REST-Endpoints      │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ documents · storage · events · functions ·│
                        │ metrics · plans · quotas · backup ·       │
                        │ flows (/v1/flows) · MCP (/v1/mcp) [Prev.] │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   (Sagas, Appliers)           scheduling-engine / backup-status   (pg & documents → Kafka)
                               workflow-worker (Flows-Interpreter)
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL (RLS + Schema pro Mandant) · FerretDB+DocumentDB · Kafka · SeaweedFS · │
   │ OpenBao (Secrets) · Keycloak (Realm pro Mandant + OAuth 2.1 für MCP) ·   │
   │ Temporal (Flows-Engine) · Knative (Funktionen + MCP-Runtime pro Mandant) │
   └────────────────────────────────────────────────────────────────────────┘
```

Die Plattform ist ein **pnpm + Turbo Monorepo** aus Node.js-Services (ES-Module)
und einer React + Vite Web-Konsole, das mit Helm auf Kubernetes deployt und hinter
ein APISIX-Gateway gestellt wird.

---

## Für KI gebaut: ein BaAIS

Falcone beginnt dort, wo jede Backend-Plattform beginnt — mandantenfähige Daten, Authentifizierung,
Speicher, Events und Funktionen hinter einer einzigen API — und richtet das darauf aus, wie Software
zunehmend gebaut und betrieben wird: **von und für KI-Agenten.**

Wir nennen diese Kategorie ein **BaAIS** — ein *Backend-as-an-AI-Service*, ein Wortspiel mit „BaaS"
für eine KI-native Welt. (Die Auflösung ist bewusst locker gehalten; entscheidend ist die Richtung,
nicht das Akronym.) Konkret bedeutet „für KI gebaut", dass das Backend eines Mandanten so gestaltet
ist, dass es **nativ von Agenten konsumierbar** ist, nicht nur von Anwendungscode:

- **MCP-Server-Hosting** *(Preview)* — ein Mandant stellt sein Backend (Daten, Speicher, Funktionen)
  als [Model-Context-Protocol](https://modelcontextprotocol.io)-Server bereit, sodass jeder
  MCP-fähige Agent es unter der Isolation, Authentifizierung und den Kontingenten dieses Mandanten
  entdecken und aufrufen kann. Die Management-API wird live unter `/v1/mcp` bereitgestellt; Instant
  MCP und der offizielle Server funktionieren durchgängig.
- **Agentische Workflows** *(Preview)* — die Temporal-basierte **Flows**-Engine erlaubt es Mandanten,
  langlebige, mehrstufige Workflows aus einem JSON-Schema-DSL zu definieren, mit einem hauseigenen
  Aktivitätskatalog, dessen Credentials pro Mandant eingegrenzt sind — das verlässliche Fundament,
  das ein Agent braucht, um über Services hinweg zu handeln.

Alles, was ein Agent berührt, bleibt innerhalb desselben Vertrags wie der Rest der Plattform: pro
Mandant und Workspace eingegrenzt, durch die Plan-Fähigkeiten gesteuert und auditiert.

---

## Roadmap

Falcone ist pre-1.0 und entwickelt sich schnell; dies ist die kurzfristige Richtung, keine Zusage.

**Verfügbar (Preview).** Beide AI-nativen Vorzeigefunktionen sind gelandet und dokumentiert; sie
bleiben Preview unter dem obigen „nicht produktionsreif"-Hinweis:

- **MCP-Server-Hosting** — die Management-API wird live unter `/v1/mcp` bereitgestellt; **Instant
  MCP** und der **offizielle Server** funktionieren durchgängig (erstellen → kuratieren →
  veröffentlichen → aufrufen → beobachten), mit Isolation pro Mandant, OAuth, Kontingenten,
  Registry/Versionierung und Audit. Der Serverzustand ist derzeit In-Memory (Einzelreplik).
  ([Epic #386](https://github.com/gntik-ai/falcone/issues/386))
- **Flows — langlebige Workflow-Engine (Temporal)** — vom Mandanten definierte Workflows über ein
  JSON-Schema-DSL und einen Interpreter-Worker, ein hauseigener Aktivitätskatalog mit pro Mandant
  eingegrenzten Credentials, Trigger und ein visueller Designer.
  ([Epic #355](https://github.com/gntik-ai/falcone/issues/355))

**In Arbeit / geplant.**

- **Nächste MCP-Schritte** — eine dauerhafte (Postgres-basierte) Server-Registry mit mehreren
  Replikas; Custom-Hosting (eigenes Image) auf dem Live-Erstellungspfad; das Verdrahten von
  Workflows-as-MCP-Tools; und eine direkte MCP-Protokoll-Verbindung pro Server (heute vermittelt die
  Control-Plane die Tool-Aufrufe).
- **Objektspeicher — MinIO → SeaweedFS (abgeschlossen).** **SeaweedFS** (Apache-2.0) ist der
  Objektspeicher ([ADR-13](docs-site/architecture/adrs.md)), wird vom Umbrella-Chart deployt und ist
  standardmäßig aktiviert; die ehemalige MinIO-`storage`-Komponente wurde entfernt. Siehe das
  [SeaweedFS-Storage-Runbook](docs-site/architecture/seaweedfs.md).
- **Dokumentspeicher — MongoDB → FerretDB + DocumentDB (abgeschlossen).** **FerretDB v2** (Apache-2.0,
  kompatibel mit dem MongoDB-Wire-Protokoll) über eine **DocumentDB-/PostgreSQL**-Engine (MIT) ist der
  Dokumentspeicher ([ADR-14](docs-site/architecture/adrs.md#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)),
  wird vom Umbrella-Chart deployt; die ehemalige MongoDB-Server-Komponente wurde entfernt. Der
  MongoDB-Treiber, das Wire-Protokoll und die Daten-API im Mongo-Stil sind unverändert. Siehe das
  [FerretDB-Dokumentspeicher-Runbook](docs-site/architecture/ferretdb.md).
- **Auf dem Weg zu einem ersten stabilen Release** — *geplant.* Sicherheitsaudit,
  Stabilitätszusicherungen für APIs/Schemata und Migrationswerkzeuge (siehe den Hinweis oben).

---

## Fähigkeiten

| Bereich | Was es einem Mandanten bietet |
| --- | --- |
| **Mandanten-Lebenszyklus** | Mandanten anlegen, sperren, soft-löschen und endgültig löschen über eine geschützte Zustandsmaschine (`draft → provisioning → active → suspended → soft_deleted`), mit Governance-Dashboards und Doppelbestätigung bei destruktiven Aktionen. |
| **Provisioning-Saga** | Asynchrone Orchestrierung, die einen Mandanten über alle Bereiche hinweg aufbaut (oder abbaut) — IAM-Realm, Kafka-Namespace, Postgres-Schema, Dokumentspeicher (FerretDB/DocumentDB), Speicher-Namespace, Funktions-Namespace — mit Vorabprüfungen und Rollback bei Fehlern. |
| **Workspaces** | Sub-Mandanten-Grenzen mit eigenem Slug, eigener Umgebung, IAM-Scope und Mitgliedschaft. Workspaces mit expliziten Richtlinien klonen; Auflösung der Vererbung von geteilten vs. spezialisierten Ressourcen. |
| **Authentifizierung & IAM** | OIDC-delegierter Konsolen-Login, Registrierung mit ausstehender Aktivierung, Passwort-Wiederherstellung. Keycloak-Administration (Realm pro Mandant) von Realms, Clients, Rollen, Scopes und Benutzern. JWT-Validierung über gecachtes JWKS mit Introspection-Fallback. |
| **Service-Accounts & OAuth2-Apps** | OAuth2-Clients und API-Key-Service-Accounts pro Workspace, mit HTTPS-Redirect-URI-Validierung und planbasierten Limits. |
| **PostgreSQL** | Mandanten-eingegrenzte Daten-API plus Administration/Governance, Change-Data-Capture, Metriken und Audit. Isolation über Row-Level-Security (`app.tenant_id` / `app.workspace_id`) und Schemas pro Mandant. |
| **Dokumentspeicher (FerretDB + DocumentDB)** | Dokument-API pro Mandant/Workspace, Administration, Echtzeit/CDC (logische Replikation von Postgres), Metriken und Audit. Kompatibel mit dem MongoDB-Wire-Protokoll; ersetzt MongoDB (ADR-14). |
| **Objektspeicher** | S3-kompatible Buckets, Multipart-Uploads, vorsignierte URLs, Zugriffsrichtlinien, Event-Benachrichtigungen und Kapazitätskontingente pro Mandant. |
| **Events (Kafka)** | Topic-Verwaltung und mandanten-eingegrenzte CDC-Streams (`<Präfix>.<Mandant>.<Workspace>`), gespeist durch die logische Replikation von PostgreSQL, plus System-Topics für Audit/Kontingent/Lebenszyklus. |
| **Echtzeit** | WebSocket-Abonnements (`/v1/websockets`) mit Bearer-JWT-Authentifizierung, Scope-zu-Channel-Durchsetzung und Mandanten-Isolation pro Sitzung. |
| **Funktionen** | Serverless-Funktionen mit Versionen, Aktivierungen, Aufrufen, Rollback und Cron- / Kafka- / Storage-Triggern. |
| **Webhooks** | Signierte Webhook-Zustellung mit Retries und SSRF-Schutz (private, Loopback-, Link-Local- und ULA-Bereiche blockiert, zum Zustellzeitpunkt erneut geprüft). |
| **Scheduling** | Cron-Jobs mit Nebenläufigkeits- und Job-Anzahl-Kontingenten pro Workspace und vollständigem Ausführungs-Audit. |
| **Flows (Workflow-Engine)** | Vom Mandanten definierte langlebige Workflows auf einer Temporal-basierten Engine: ein JSON-Schema-DSL und ein Interpreter-Worker, ein hauseigener Aktivitätskatalog mit pro Mandant eingegrenzten Credentials, Trigger (Schedules, Webhooks, Plattform-Events) und ein visueller Designer in der Konsole. *Preview ([Epic #355](https://github.com/gntik-ai/falcone/issues/355)).* |
| **MCP-Server-Hosting** | Hosting von Model-Context-Protocol-Servern des Mandanten, damit KI-Agenten das Backend als Tools aufrufen. Management-API live unter `/v1/mcp`: Instant MCP (aus einer Ressource generierte Tools), der offizielle read-first-Server, verpflichtende Kuratierung, Registry/Versionierung mit Rug-Pull-Prüfung, OAuth 2.1, Kontingente/Rate-Limits pro Mandant und Audit. *Preview — Instant MCP + offizieller Server live (In-Memory-Zustand); Custom-Image-Hosting und Workflows-as-Tools sind experimentell ([Epic #386](https://github.com/gntik-ai/falcone/issues/386)).* |
| **Pläne & Kontingente** | Kommerzielle Pläne werden auf Capability-Keys, Kontingent-Standardwerte und ein Deployment-Profil abgebildet. Kontingente erzwingen Modi hard-block / soft-grace / soft-exhausted pro Mandant und Workspace. |
| **Backup & Wiederherstellung** | Snapshot-Auflistung, Wiederherstellungs-Orchestrierung und Point-in-Time-Recovery-Simulation (PITR) über S3- / Postgres- / Mongo-Adapter. |
| **Observability & Audit** | Audit-Pipeline pro Mandant (Akteur, Scope-Envelope, Ressource, Aktion, Ergebnis), an Kafka gestreamt und persistiert, mit Metrik-Familien, Health-Checks, Dashboards und Schwellenwert-Alerts. |
| **API-Gateway** | Eine einzige öffentliche Oberfläche unter `/v1` mit erforderlichen Idempotenz-Keys, Correlation-IDs, Request-Validierung und Timeouts/Retries pro Route. |
| **Web-Konsole** | React + Vite Admin-UI für Mandanten, Workspaces, Mitglieder, Datenbanken, Speicher, Funktionen, Events, Pläne, Kontingente und Observability. |

---

## Schnellstart mit Docker Compose

Das Repository liefert einen Compose-Stack, der die **echten Backing-Services**
hochfährt, mit denen Falcone spricht — PostgreSQL, Keycloak, Redpanda (Kafka),
FerretDB + DocumentDB (Dokumentspeicher mit MongoDB-Wire-Protokoll), SeaweedFS (S3) und OpenBao — sowie ein
APISIX-Gateway und einen Action-Runner. Das ist der schnellste Weg zu einer
funktionierenden Umgebung auf deiner Maschine.

### Voraussetzungen

- Docker mit dem Compose-Plugin (`docker compose`)
- Node.js 20+ und `pnpm` (über `corepack enable`) — nur nötig, um die Suites auszuführen

### 1. Klonen und installieren

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
corepack enable
pnpm install
```

### 2. Den Stack mit Docker Compose hochfahren

Das Hilfsskript richtet Health-Checks, Migrationen, den FerretDB + DocumentDB-Dokumentspeicher, den
SeaweedFS-Bucket und das OpenBao-Audit-Device für dich ein:

```bash
cd tests/env
./up.sh
```

…oder steuere Compose direkt, wenn du nur die Container möchtest:

```bash
docker compose -f tests/env/docker-compose.yml up -d --build
docker compose -f tests/env/docker-compose.yml ps
```

### 3. Services und Ports

| Service | URL / Endpoint | Zugangsdaten |
| --- | --- | --- |
| API-Gateway (APISIX) | <http://localhost:9080> | Bearer-JWT von Keycloak |
| Keycloak (IdP) | <http://localhost:8081> | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| FerretDB gateway (MongoDB wire) | `localhost:57017` | `falcone` / `falcone` |
| Redpanda (Kafka) | `localhost:19092` | — |
| SeaweedFS (S3-API) | <http://localhost:58333> | S3-Access-Key / Secret-Key (path-style) |
| OpenBao (dev) | <http://localhost:58200> | Token `root` |

### 4. Ausprobieren

```bash
# Unit- / Contract- / E2E-Suites gegen den laufenden Stack ausführen
pnpm test

# oder die Black-Box-Contract-Suite (nur öffentliche Schnittstelle)
bash tests/blackbox/run.sh
```

### 5. Herunterfahren

```bash
cd tests/env
./down.sh
# oder: docker compose -f tests/env/docker-compose.yml down -v
```

> Für ein vollständiges produktionsreifes Deployment (Funktions-Runtime, die
> control-plane und die Web-Konsole) verwende die Helm-Charts unter `helm/` und
> `charts/` auf einem Kubernetes-Cluster — siehe die Manifeste in `deploy/`.

---

## Repository-Aufbau

```text
apps/            control-plane (REST-API-Oberfläche) · web-console (React-UI) ·
                 cli (falcone-CLI: mcp init/dev/deploy) · mcp-server-sdk (mandanten-eingegrenztes MCP-Tool-SDK)
services/        gateway-config, realtime-gateway, webhook-engine, cdc-bridges,
                 scheduling-engine, provisioning-orchestrator, backup-status,
                 workflow-worker (Flows-DSL-Interpreter), audit, adapters,
                 internal-contracts, …
charts/ helm/    Kubernetes- / Helm-Deployment (inkl. Komponenten temporal, workflowWorker, mcp)
deploy/          APISIX-Routen, kind/OpenShift-Bootstrap
tests/           blackbox (Contract) · e2e (Playwright, inkl. mcp-Specs) · env (Compose-Stack)
```

---

## Drittanbieter-Software und Lizenzen

Falcone selbst steht unter der **MIT-Lizenz** (siehe [LICENSE](./LICENSE)). Es baut auf der unten
aufgeführten Drittanbieter-Software auf. Mit ⚠ markierte Komponenten sind **copyleft oder
source-available** (kein OSI-Open-Source) — siehe den folgenden Kompatibilitätshinweis.

### Plattform & Infrastruktur (als Services / Images deployt)

| Komponente | Rolle in Falcone | Lizenz (SPDX) | Link |
| --- | --- | --- | --- |
| PostgreSQL 16 (+ pgvector) | Primärer Mandanten-Datastore; RLS + Schema-pro-Mandant-Isolation; pgvector für Vektorsuche | `PostgreSQL` | [postgresql.org](https://www.postgresql.org/about/licence/) · [pgvector](https://github.com/pgvector/pgvector) |
| FerretDB v2 (über DocumentDB / PostgreSQL 17) | Dokument-Daten-API — kompatibel mit dem MongoDB-Wire-Protokoll ([ADR-14](docs-site/architecture/adrs.md)) | `Apache-2.0` (Gateway) + `MIT` (DocumentDB-Erweiterung) | [ferretdb](https://github.com/FerretDB/FerretDB) · [documentdb](https://github.com/microsoft/documentdb) |
| Redpanda 24.2 | Kafka-kompatibler Event-Bus / CDC-Streaming | ⚠ `BSL-1.1` (Redpanda) + `RCL` | [licenses](https://github.com/redpanda-data/redpanda/tree/dev/licenses) |
| SeaweedFS 4.33 | S3-kompatibler Objektspeicher ([ADR-13](docs-site/architecture/adrs.md)) | `Apache-2.0` | [seaweedfs](https://github.com/seaweedfs/seaweedfs) |
| OpenBao 2.3.1 | Secrets-Management | `MPL-2.0` | [LICENSE](https://github.com/openbao/openbao/blob/main/LICENSE) |
| Keycloak 26 | IAM mit Realm pro Mandant / OIDC | `Apache-2.0` | [keycloak](https://github.com/keycloak/keycloak) |
| Apache APISIX 3.9 | API-Gateway (öffentliche `/v1`-Oberfläche) | `Apache-2.0` | [apisix](https://github.com/apache/apisix) |
| Temporal (Server 1.25 + TypeScript-SDK 1.18) | Langlebige Workflow-Engine hinter Flows | `MIT` | [temporal](https://github.com/temporalio/temporal) · [sdk-typescript](https://github.com/temporalio/sdk-typescript) |
| Knative Serving + Kourier | Serverless-Funktions-Runtime | `Apache-2.0` | [serving](https://github.com/knative/serving) · [net-kourier](https://github.com/knative-extensions/net-kourier) |
| Kubernetes + Helm | Deployment & Orchestrierung | `Apache-2.0` | [kubernetes](https://github.com/kubernetes/kubernetes) · [helm](https://github.com/helm/helm) |
| Node.js 22 | Service-Runtime | `MIT` | [nodejs](https://github.com/nodejs/node) |
| nginx | Statisches Ausliefern des Web-Konsolen-Images | `BSD-2-Clause` | [nginx.org](https://nginx.org/LICENSE) |

### Wichtigste Anwendungs-Frameworks & -Bibliotheken (npm)

| Komponente | Rolle in Falcone | Lizenz (SPDX) | Link |
| --- | --- | --- | --- |
| React 18 | UI der Web-Konsole | `MIT` | [react](https://github.com/facebook/react) |
| Vite | Build & Dev-Server der Konsole | `MIT` | [vite](https://github.com/vitejs/vite) |
| TypeScript | Typisierter Code (Konsole, Workflow-Worker) | `Apache-2.0` | [TypeScript](https://github.com/microsoft/TypeScript) |
| Tailwind CSS | Styling der Konsole | `MIT` | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| React Flow (`@xyflow/react`) | Canvas des visuellen Flows-Designers | `MIT` | [xyflow](https://github.com/xyflow/xyflow) |
| Monaco Editor (+ `monaco-yaml`) | Code-/YAML-Bearbeitung in der Konsole | `MIT` | [monaco-editor](https://github.com/microsoft/monaco-editor) |
| node-postgres (`pg`) | PostgreSQL-Client | `MIT` | [node-postgres](https://github.com/brianc/node-postgres) |
| MongoDB Node Driver (`mongodb`) | Dokumentspeicher-Client — MongoDB-Wire-Protokoll (MongoDB / FerretDB) | `Apache-2.0` | [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) |
| KafkaJS | Kafka-/Redpanda-Client | `MIT` | [kafkajs](https://github.com/tulios/kafkajs) |
| AWS SDK for JS v3 (`@aws-sdk/client-s3`) | S3-Objektspeicher-Client (SeaweedFS) | `Apache-2.0` | [aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| jose + jwks-rsa | JWT-/JWKS-Validierung | `MIT` | [jose](https://github.com/panva/jose) · [node-jwks-rsa](https://github.com/auth0/node-jwks-rsa) |
| ws | WebSocket-Echtzeit-Gateway | `MIT` | [ws](https://github.com/websockets/ws) |
| Ajv | JSON-Schema-Validierung | `MIT` | [ajv](https://github.com/ajv-validator/ajv) |
| cel-js | Auswertung von Capability-/Policy-Ausdrücken | `MIT` | [cel-js](https://www.npmjs.com/package/cel-js) |
| Playwright | E2E-Tests auf echtem Stack | `Apache-2.0` | [playwright](https://github.com/microsoft/playwright) |

> [!IMPORTANT]
> **Lizenzkompatibilität — Prüfung erforderlich.** Falcones eigener Code steht unter **MIT**, was
> mit der Nutzung aller oben genannten permissiven Komponenten (MIT, Apache-2.0, ISC, BSD,
> PostgreSQL) kompatibel ist. Die mit ⚠ markierten Komponenten sind **kein** OSI-Open-Source und
> verdienen eine Prüfung:
> - **Redpanda (`BSL-1.1` + `RCL`)** ist source-available.
>   Die ehemaligen Abhängigkeiten **MongoDB (`SSPL-1.0`)** und **MinIO (`AGPL-3.0`)** wurden
>   **entfernt** — abgelöst durch **FerretDB** (`Apache-2.0`, [ADR-14](docs-site/architecture/adrs.md))
>   bzw. **SeaweedFS** (`Apache-2.0`, [ADR-13](docs-site/architecture/adrs.md)), womit ihr
>   SSPL-/AGPL-Risiko entfällt.
> - Redpanda als **separaten Backing-Service zu betreiben, mit dem Falcone über das Netzwerk spricht**,
>   erlegt dessen Lizenz dem MIT-Code von Falcone für sich genommen nicht auf (kein Linking / kein
>   abgeleitetes Werk). **Aber** seine „Als-Service-anbieten"- / „Wettbewerbsdienst"-Klauseln sind für
>   ein mandantenfähiges BaaS, das dessen Funktionalität an Mandanten **weiter exponiert**, direkt
>   relevant — eine Kafka-/Event-API. Insbesondere schließt die BSL-Gewährung von Redpanda
>   konkurrierende Managed-Angebote aus. Prüfe diese Bedingungen vor jedem gehosteten oder
>   kommerziellen Angebot; Redpanda ist auf der Deployment-Ebene austauschbar, falls seine Bedingungen
>   nicht zu deinem Anwendungsfall passen.
> - **Objektspeicher: MinIO → SeaweedFS (Apache-2.0).** Gemäß
>   [ADR-13](docs-site/architecture/adrs.md) ist **SeaweedFS** der Objektspeicher, gezielt gewählt, um
>   das mit MinIO verbundene **AGPL-§13**-Risiko des „Als-Service-Anbietens" für ein BaaS zu
>   beseitigen, das S3 an Mandanten weiter exponiert. Die ehemalige MinIO-Abhängigkeit wurde entfernt.
> - **Dokumentspeicher: MongoDB → FerretDB + DocumentDB (Apache-2.0 + MIT).** Gemäß
>   [ADR-14](docs-site/architecture/adrs.md) ist **FerretDB v2** über eine DocumentDB-/PostgreSQL-Engine
>   der Dokumentspeicher, womit das mit MongoDB verbundene **SSPL-§13**-Risiko entfällt. FerretDB
>   behält den MongoDB-Treiber und das Wire-Protokoll unverändert bei; die ehemalige
>   MongoDB-Server-Abhängigkeit wurde entfernt.

**Nicht vollständig.** Diese Tabelle listet die **wichtigsten** Drittanbieter-Komponenten auf,
nicht den vollständigen Baum transitiver Abhängigkeiten (kleinere Hilfsbibliotheken — `undici`,
`clsx`, `lucide-react`, `uuid`, `cron-parser`, `js-yaml` usw. — werden weggelassen). Für ein
vollständiges Bild erzeuge eine SBOM / einen Lizenzbericht — z. B. `license-checker` oder
`pnpm licenses list` für die npm-Workspaces — und, falls später Python- oder Go-Komponenten
hinzukommen, `pip-licenses` bzw. `go-licenses`. Prüfe die Ausgabe vor der Verteilung.

---

## Lizenz

Siehe [LICENSE](./LICENSE).
