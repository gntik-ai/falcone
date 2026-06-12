<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>Eine mandantenfähige (multitenant) Backend-as-a-Service (BaaS)-Plattform.</strong>

  <p>Datenbanken, Speicher, Authentifizierung, Events, Echtzeit und Serverless-Funktionen — pro Mandant isoliert, durch Pläne und Kontingente gesteuert, hinter einer einzigen API.</p>

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

```
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API Gateway (APISIX)   /v1   Idempotenz, CORS,  │
                    löst Mandant auf ▸ injiziert Identität, Corr-ID │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 249+ REST-Endpoints      │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ mongo · storage · events · functions ·    │
                        │ metrics · plans · quotas · backup         │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   (Sagas, Appliers)           scheduling-engine / backup-status   (pg & mongo → Kafka)
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL (RLS + Schema pro Mandant) · MongoDB · Kafka · S3/MinIO ·     │
   │ Vault (Secrets) · Keycloak (IAM: Realm pro Mandant)                      │
   └────────────────────────────────────────────────────────────────────────┘
```

Die Plattform ist ein **pnpm + Turbo Monorepo** aus Node.js-Services (ES-Module)
und einer React + Vite Web-Konsole, das mit Helm auf Kubernetes deployt und hinter
ein APISIX-Gateway gestellt wird.

---

## Fähigkeiten

| Bereich | Was es einem Mandanten bietet |
| --- | --- |
| **Mandanten-Lebenszyklus** | Mandanten anlegen, sperren, soft-löschen und endgültig löschen über eine geschützte Zustandsmaschine (`draft → provisioning → active → suspended → soft_deleted`), mit Governance-Dashboards und Doppelbestätigung bei destruktiven Aktionen. |
| **Provisioning-Saga** | Asynchrone Orchestrierung, die einen Mandanten über alle Bereiche hinweg aufbaut (oder abbaut) — IAM-Realm, Kafka-Namespace, Postgres-Schema, MongoDB, Speicher-Namespace, Funktions-Namespace — mit Vorabprüfungen und Rollback bei Fehlern. |
| **Workspaces** | Sub-Mandanten-Grenzen mit eigenem Slug, eigener Umgebung, IAM-Scope und Mitgliedschaft. Workspaces mit expliziten Richtlinien klonen; Auflösung der Vererbung von geteilten vs. spezialisierten Ressourcen. |
| **Authentifizierung & IAM** | OIDC-delegierter Konsolen-Login, Registrierung mit ausstehender Aktivierung, Passwort-Wiederherstellung. Keycloak-Administration (Realm pro Mandant) von Realms, Clients, Rollen, Scopes und Benutzern. JWT-Validierung über gecachtes JWKS mit Introspection-Fallback. |
| **Service-Accounts & OAuth2-Apps** | OAuth2-Clients und API-Key-Service-Accounts pro Workspace, mit HTTPS-Redirect-URI-Validierung und planbasierten Limits. |
| **PostgreSQL** | Mandanten-eingegrenzte Daten-API plus Administration/Governance, Change-Data-Capture, Metriken und Audit. Isolation über Row-Level-Security (`app.tenant_id` / `app.workspace_id`) und Schemas pro Mandant. |
| **MongoDB** | Dokument-API pro Mandant/Workspace, Administration, Change Streams, Metriken und Audit. |
| **Objektspeicher** | S3-kompatible Buckets, Multipart-Uploads, vorsignierte URLs, Zugriffsrichtlinien, Event-Benachrichtigungen und Kapazitätskontingente pro Mandant. |
| **Events (Kafka)** | Topic-Verwaltung und mandanten-eingegrenzte CDC-Change-Streams (`<Präfix>.<Mandant>.<Workspace>`), plus System-Topics für Audit/Kontingent/Lebenszyklus. |
| **Echtzeit** | WebSocket-Abonnements (`/v1/websockets`) mit Bearer-JWT-Authentifizierung, Scope-zu-Channel-Durchsetzung und Mandanten-Isolation pro Sitzung. |
| **Funktionen** | Serverless-Funktionen mit Versionen, Aktivierungen, Aufrufen, Rollback und Cron- / Kafka- / Storage-Triggern. |
| **Webhooks** | Signierte Webhook-Zustellung mit Retries und SSRF-Schutz (private, Loopback-, Link-Local- und ULA-Bereiche blockiert, zum Zustellzeitpunkt erneut geprüft). |
| **Scheduling** | Cron-Jobs mit Nebenläufigkeits- und Job-Anzahl-Kontingenten pro Workspace und vollständigem Ausführungs-Audit. |
| **Pläne & Kontingente** | Kommerzielle Pläne werden auf Capability-Keys, Kontingent-Standardwerte und ein Deployment-Profil abgebildet. Kontingente erzwingen Modi hard-block / soft-grace / soft-exhausted pro Mandant und Workspace. |
| **Backup & Wiederherstellung** | Snapshot-Auflistung, Wiederherstellungs-Orchestrierung und Point-in-Time-Recovery-Simulation (PITR) über S3- / Postgres- / Mongo-Adapter. |
| **Observability & Audit** | Audit-Pipeline pro Mandant (Akteur, Scope-Envelope, Ressource, Aktion, Ergebnis), an Kafka gestreamt und persistiert, mit Metrik-Familien, Health-Checks, Dashboards und Schwellenwert-Alerts. |
| **API-Gateway** | Eine einzige öffentliche Oberfläche unter `/v1` mit erforderlichen Idempotenz-Keys, Correlation-IDs, Request-Validierung und Timeouts/Retries pro Route. |
| **Web-Konsole** | React + Vite Admin-UI für Mandanten, Workspaces, Mitglieder, Datenbanken, Speicher, Funktionen, Events, Pläne, Kontingente und Observability. |

---

## Schnellstart mit Docker Compose

Das Repository liefert einen Compose-Stack, der die **echten Backing-Services**
hochfährt, mit denen Falcone spricht — PostgreSQL, Keycloak, Redpanda (Kafka),
MongoDB (Single-Node-Replica-Set), MinIO (S3) und Vault — sowie ein
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

Das Hilfsskript richtet Health-Checks, Migrationen, das Mongo-Replica-Set, den
MinIO-Bucket und das Vault-Audit-Device für dich ein:

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
| API-Gateway (APISIX) | http://localhost:9080 | Bearer-JWT von Keycloak |
| Keycloak (IdP) | http://localhost:8081 | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| MongoDB (rs0) | `localhost:57017` | — |
| Redpanda (Kafka) | `localhost:19092` | — |
| MinIO (S3-API) | http://localhost:59000 | `minioadmin` / `minioadmin` |
| MinIO-Konsole | http://localhost:59001 | `minioadmin` / `minioadmin` |
| Vault (dev) | http://localhost:58200 | Token `root` |

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

```
apps/            control-plane (REST-API-Oberfläche) · web-console (React-UI)
services/        gateway-config, realtime-gateway, webhook-engine, cdc-bridges,
                 scheduling-engine, provisioning-orchestrator, backup-status,
                 audit, adapters, internal-contracts, …
charts/ helm/    Kubernetes- / Helm-Deployment
deploy/          APISIX-Routen, kind/OpenShift-Bootstrap
tests/           blackbox (Contract) · e2e (Playwright) · env (Compose-Stack)
openspec/        Spezifikationsgetriebener Änderungs-Workflow
```

---

## Lizenz

Siehe [LICENSE](./LICENSE).
