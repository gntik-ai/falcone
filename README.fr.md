<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>Une plateforme Backend-as-a-Service (BaaS) multitenant.</strong>

  <p>Bases de données, stockage, authentification, événements, temps réel et fonctions serverless — isolés par tenant, gouvernés par des plans et des quotas, derrière une seule API.</p>

  <p>
    <img alt="Statut : développement précoce" src="https://img.shields.io/badge/status-early%20development-orange" />
    <img alt="Pas prêt pour la production" src="https://img.shields.io/badge/production-not%20ready-critical" />
    <img alt="Licence : MIT" src="https://img.shields.io/badge/license-MIT-blue" />
  </p>

  <sub>

  [English](./README.md) ·
  [Español](./README.es.md) ·
  **Français** ·
  [Deutsch](./README.de.md) ·
  [中文](./README.zh.md) ·
  [Русский](./README.ru.md)

  </sub>
</div>

---

> [!WARNING]
> **Falcone n'est pas prêt pour la production.** Le projet est en développement précoce et actif.
> Les API publiques, les schémas de données et le comportement à l'exécution peuvent changer à tout
> moment, sans préavis ni chemin de migration. À ce stade, il n'existe **aucune garantie de
> stabilité, de sécurité ou de support**, et le projet n'a pas fait l'objet d'un audit de sécurité.
> **N'exécutez pas Falcone pour des charges de production et ne lui confiez pas de données
> sensibles.** Utilisez-le uniquement pour l'évaluation, l'expérimentation et le développement.

---

## Le principe derrière Falcone

Presque tous les produits ont besoin de la même plomberie backend : une base de
données, du stockage de fichiers, l'authentification des utilisateurs, des tâches
de fond, un bus d'événements, des mises à jour en temps réel. Construire et
exploiter cette plomberie **une fois par application — et de nouveau pour chaque
client —** est l'endroit où les équipes perdent du temps et où naissent les
incidents de sécurité.

Falcone existe pour résoudre cela une seule fois. C'est un **BaaS multitenant** :
une plateforme unique qui sert de nombreux tenants isolés, chacun avec ses propres
données, identités et ressources, exposés via une API cohérente.

Deux idées tiennent tout le système ensemble :

1. **L'isolation des tenants est le contrat, pas une fonctionnalité.**
   Chaque lecture et chaque écriture sont délimitées par `tenant_id` (et, un niveau
   en dessous, par `workspace_id`). L'identité est résolue à la périphérie à partir
   d'un token, propagée comme un contexte explicite à travers la passerelle, les
   services, la couche de données et les tâches de fond, et appliquée dans la base
   de données via la sécurité au niveau des lignes et des schémas par tenant. La
   fuite inter-tenant est traitée comme le bug cardinal.

2. **Les capacités sont accordées par plan et appliquées partout.**
   Ce qu'un tenant peut faire — SQL, temps réel, webhooks, fonctions, Kafka,
   stockage — est l'intersection de son **plan commercial**, du **profil de
   déploiement** et de l'**environnement**. La passerelle filtre les routes selon ces
   clés de capacité, les quotas plafonnent la consommation par tenant/workspace, et
   chaque refus est audité.

Le résultat est une plateforme où un client obtient un backend complet en quelques
minutes, et où l'opérateur conserve une surface unique, gouvernable et
observable — au lieu d'une flotte de backends artisanaux.

### Comment tout s'assemble

```text
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API Gateway (APISIX)   /v1   idempotence, CORS,  │
                    résout le tenant ▸ injecte identité, correlation │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 250+ endpoints REST      │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ documents · storage · events · functions ·│
                        │ metrics · plans · quotas · backup ·       │
                        │ flows (/v1/flows) · MCP (/v1/mcp) [Prev.] │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   (sagas, appliers)           scheduling-engine / backup-status   (pg & documents → Kafka)
                               workflow-worker (interpréteur Flows)
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL (RLS + schéma par tenant) · FerretDB+DocumentDB · Kafka · SeaweedFS · │
   │ OpenBao (secrets) · Keycloak (IAM realm par tenant + OAuth 2.1 pour MCP) │
   │ Temporal (moteur Flows) · Knative (functions + runtime MCP par tenant)   │
   └────────────────────────────────────────────────────────────────────────┘
```

La plateforme est un **monorepo pnpm + Turbo** de services Node.js (modules ES) et
une console web React + Vite, déployée avec Helm sur Kubernetes et placée derrière
une passerelle APISIX.

---

## Conçu pour l'IA : un BaAIS

Falcone part de là où part toute plateforme backend — données, authentification, stockage,
événements et fonctions multitenant derrière une seule API — et l'oriente vers la façon dont les
logiciels sont de plus en plus construits et exploités : **par, et pour, des agents d'IA.**

Nous appelons cette catégorie un **BaAIS** — un *Backend-as-an-AI-Service*, un jeu de mots sur
« BaaS » pour un monde nativement orienté IA. (L'expansion est volontairement souple ; ce qui
compte, c'est la direction, pas l'acronyme.) Concrètement, « conçu pour l'IA » signifie que le
backend d'un tenant est pensé pour être **nativement consommable par des agents**, et pas seulement
par du code applicatif :

- **Hébergement de serveurs MCP** *(Preview)* — un tenant expose son backend (données, stockage,
  fonctions) sous forme de serveur [Model Context Protocol](https://modelcontextprotocol.io), afin
  que tout agent compatible MCP puisse le découvrir et l'appeler sous l'isolation, l'authentification
  et les quotas propres à ce tenant. L'API de gestion est servie en direct sous `/v1/mcp` ; Instant
  MCP et le serveur officiel fonctionnent de bout en bout.
- **Workflows agentiques** *(Preview)* — le moteur **Flows**, basé sur Temporal, permet aux tenants de définir
  des workflows durables et multi-étapes à partir d'un DSL en JSON Schema, avec un catalogue
  d'activités natif dont les identifiants sont délimités par tenant — le socle fiable dont un agent
  a besoin pour agir entre les services.

Tout ce qu'un agent touche reste à l'intérieur du même contrat que le reste de la plateforme :
délimité par tenant et workspace, filtré par les capacités du plan, et audité.

---

## Feuille de route

Falcone est en pré-1.0 et évolue vite ; ceci est la direction à court terme, pas un engagement.

**Disponible (Preview).** Les deux capacités phares pour l'IA ont atterri et sont documentées ;
elles restent en Preview sous l'avertissement « non prêt pour la production » ci-dessus :

- **Hébergement de serveurs MCP** — l'API de gestion est servie en direct sous `/v1/mcp` ; **Instant
  MCP** et le **serveur officiel** fonctionnent de bout en bout (créer → curer → publier → appeler →
  observer), avec isolation par tenant, OAuth, quotas, registre/versionnage et audit. L'état du
  serveur est en mémoire (réplique unique) pour l'instant.
  ([épopée #386](https://github.com/gntik-ai/falcone/issues/386))
- **Flows — moteur de workflows durables (Temporal)** — workflows définis par le tenant via un DSL
  en JSON Schema et un worker interpréteur, un catalogue d'activités natif avec des identifiants
  délimités par tenant, des déclencheurs et un concepteur visuel.
  ([épopée #355](https://github.com/gntik-ai/falcone/issues/355))

**En cours / planifié.**

- **Prochains incréments MCP** — un registre de serveurs durable (sur Postgres) et multi-réplique ;
  l'hébergement personnalisé (image propre) sur le chemin de création en direct ; le câblage des
  workflows-as-MCP-tools ; et une connexion MCP directe par serveur (aujourd'hui le control-plane
  relaie les appels d'outils).
- **Stockage d'objets — MinIO → SeaweedFS (terminé).** **SeaweedFS** (Apache-2.0) est le stockage
  d'objets ([ADR-13](docs-site/architecture/adrs.md)), déployé par le chart umbrella et activé par
  défaut ; l'ancien composant `storage` MinIO a été supprimé. Voir le
  [runbook de stockage SeaweedFS](docs-site/architecture/seaweedfs.md).
- **Base documentaire — MongoDB → FerretDB + DocumentDB (terminé).** **FerretDB v2** (Apache-2.0,
  compatible avec le wire protocol de MongoDB) sur un moteur **DocumentDB / PostgreSQL** (MIT) est la
  base documentaire ([ADR-14](docs-site/architecture/adrs.md#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)),
  déployée par le chart umbrella ; l'ancien composant serveur MongoDB a été supprimé. Le pilote
  MongoDB, le wire protocol et l'API de données de style Mongo restent inchangés. Voir le
  [runbook de la base documentaire FerretDB](docs-site/architecture/ferretdb.md).
- **Vers une première version stable** — *planifié.* Audit de sécurité, garanties de stabilité des
  API/schémas et outils de migration (voir l'avertissement en haut).

---

## Capacités

| Domaine | Ce que cela offre à un tenant |
| --- | --- |
| **Cycle de vie du tenant** | Créer, suspendre, supprimer (soft-delete) et purger des tenants via une machine à états protégée (`draft → provisioning → active → suspended → soft_deleted`), avec des tableaux de bord de gouvernance et une double confirmation pour les actions destructrices. |
| **Saga de provisionnement** | Orchestration asynchrone qui met en place (ou démonte) un tenant dans chaque domaine — realm IAM, namespace Kafka, schéma Postgres, base documentaire (FerretDB/DocumentDB), namespace de stockage, namespace de fonctions — avec contrôles préalables et rollback en cas d'échec. |
| **Workspaces** | Frontières sub-tenant avec leur propre slug, environnement, périmètre IAM et adhésion. Clonage de workspaces avec des politiques explicites ; résolution de l'héritage de ressources partagées vs. spécialisées. |
| **Authentification & IAM** | Connexion console déléguée OIDC, inscription avec activation en attente, récupération de mot de passe. Administration Keycloak (realm par tenant) des realms, clients, rôles, scopes et utilisateurs. Validation JWT via JWKS en cache avec repli sur introspection. |
| **Comptes de service & apps OAuth2** | Clients OAuth2 et comptes de service à clé API par workspace, avec validation des URI de redirection HTTPS et limites imposées par le plan. |
| **PostgreSQL** | API de données délimitée par tenant plus administration/gouvernance, capture de changements (CDC), métriques et audit. Isolation par sécurité au niveau des lignes (`app.tenant_id` / `app.workspace_id`) et schémas par tenant. |
| **Base documentaire (FerretDB + DocumentDB)** | API de documents par tenant/workspace, administration, temps réel/CDC (réplication logique de Postgres), métriques et audit. Compatible avec le wire protocol de MongoDB ; remplace MongoDB (ADR-14). |
| **Stockage d'objets** | Buckets compatibles S3, uploads multipart, URLs présignées, politiques d'accès, notifications d'événements et quotas de capacité par tenant. |
| **Événements (Kafka)** | Gestion des topics et flux CDC délimités par tenant (`<préfixe>.<tenant>.<workspace>`) alimentés par la réplication logique de PostgreSQL, plus topics système d'audit/quota/cycle de vie. |
| **Temps réel** | Abonnements WebSocket (`/v1/websockets`) avec authentification Bearer-JWT, application du scope au canal et isolation du tenant par session. |
| **Fonctions** | Fonctions serverless avec versions, activations, invocations, rollback et déclencheurs cron / Kafka / stockage. |
| **Webhooks** | Livraison de webhooks signée et avec retries, avec protection SSRF (plages privées, loopback, link-local et ULA bloquées, revérifiées au moment de la livraison). |
| **Planification** | Tâches cron avec quotas de concurrence et de nombre de tâches par workspace et audit complet de l'exécution. |
| **Flows (moteur de workflows)** | Workflows durables définis par le tenant sur un moteur basé sur Temporal : un DSL en JSON Schema et un worker interpréteur, un catalogue d'activités natif avec des identifiants délimités par tenant, des déclencheurs (schedules, webhooks, événements de plateforme) et un concepteur visuel dans la console. *Preview ([épopée #355](https://github.com/gntik-ai/falcone/issues/355)).* |
| **Hébergement de serveurs MCP** | Héberger les serveurs Model Context Protocol du tenant pour que les agents d'IA appellent le backend comme des outils. API de gestion servie en direct sous `/v1/mcp` : Instant MCP (outils générés depuis une ressource), le serveur officiel read-first, curation obligatoire, registre/versionnage avec revue anti « rug-pull », OAuth 2.1, quotas/limites de débit par tenant et audit. *Preview — Instant MCP + serveur officiel en direct (état en mémoire) ; l'hébergement d'image personnalisée et les workflows-as-tools sont expérimentaux ([épopée #386](https://github.com/gntik-ai/falcone/issues/386)).* |
| **Plans & quotas** | Les plans commerciaux correspondent à des clés de capacité, des valeurs de quota par défaut et un profil de déploiement. Les quotas appliquent des modes hard-block / soft-grace / soft-exhausted par tenant et workspace. |
| **Sauvegarde & restauration** | Listing des snapshots, orchestration de la restauration et simulation de récupération à un point dans le temps (PITR) sur les adaptateurs S3 / Postgres / Mongo. |
| **Observabilité & audit** | Pipeline d'audit par tenant (acteur, enveloppe de portée, ressource, action, résultat) diffusé vers Kafka et persisté, avec familles de métriques, health checks, tableaux de bord et alertes de seuil. |
| **API gateway** | Une surface publique unique sur `/v1` avec clés d'idempotence requises, correlation IDs, validation des requêtes et timeouts/retries par route. |
| **Console web** | UI d'administration React + Vite pour tenants, workspaces, membres, bases de données, stockage, fonctions, événements, plans, quotas et observabilité. |

---

## Démarrage rapide avec Docker Compose

Le dépôt fournit une stack Compose qui démarre les **vrais services d'appui** avec
lesquels Falcone communique — PostgreSQL, Keycloak, Redpanda (Kafka), FerretDB +
DocumentDB (base documentaire au wire protocol de MongoDB), SeaweedFS (S3) et OpenBao — plus une passerelle APISIX et un
action runner. C'est le moyen le plus rapide d'obtenir un environnement
fonctionnel sur votre machine.

### Prérequis

- Docker avec le plugin Compose (`docker compose`)
- Node.js 20+ et `pnpm` (via `corepack enable`) — nécessaire uniquement pour exécuter les suites

### 1. Cloner et installer

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
corepack enable
pnpm install
```

### 2. Démarrer la stack avec Docker Compose

Le script utilitaire configure pour vous les health checks, les migrations, la base
documentaire FerretDB + DocumentDB, le bucket SeaweedFS et le dispositif d'audit OpenBao :

```bash
cd tests/env
./up.sh
```

…ou pilotez Compose directement si vous ne voulez que les conteneurs :

```bash
docker compose -f tests/env/docker-compose.yml up -d --build
docker compose -f tests/env/docker-compose.yml ps
```

### 3. Services et ports

| Service | URL / endpoint | Identifiants |
| --- | --- | --- |
| API gateway (APISIX) | <http://localhost:9080> | Bearer JWT de Keycloak |
| Keycloak (IdP) | <http://localhost:8081> | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| FerretDB gateway (MongoDB wire) | `localhost:57017` | `falcone` / `falcone` |
| Redpanda (Kafka) | `localhost:19092` | — |
| SeaweedFS (API S3) | <http://localhost:58333> | Clé d'accès / clé secrète S3 (path-style) |
| OpenBao (dev) | <http://localhost:58200> | token `root` |

### 4. Mettez-la à l'épreuve

```bash
# Exécutez les suites unit / contract / e2e contre la stack en direct
pnpm test

# ou la suite de contrat black-box (interface publique uniquement)
bash tests/blackbox/run.sh
```

### 5. Démontez-la

```bash
cd tests/env
./down.sh
# ou : docker compose -f tests/env/docker-compose.yml down -v
```

> Pour un déploiement complet de qualité production (runtime des fonctions, le
> control-plane et la console web), utilisez les charts Helm sous `helm/` et
> `charts/` sur un cluster Kubernetes — voir les manifestes dans `deploy/`.

---

## Structure du dépôt

```text
apps/            control-plane (surface API REST) · web-console (UI React) ·
                 cli (CLI falcone : mcp init/dev/deploy) · mcp-server-sdk (SDK d'outils MCP par tenant)
services/        gateway-config, realtime-gateway, webhook-engine, cdc-bridges,
                 scheduling-engine, provisioning-orchestrator, backup-status,
                 workflow-worker (interpréteur du DSL Flows), audit, adapters,
                 internal-contracts, …
charts/ helm/    Déploiement Kubernetes / Helm (incl. composants temporal, workflowWorker, mcp)
deploy/          Routes APISIX, bootstrap kind/OpenShift
tests/           blackbox (contrat) · e2e (Playwright, incl. specs mcp) · env (stack Compose)
```

---

## Logiciels tiers et licences

Falcone lui-même est sous **licence MIT** (voir [LICENSE](./LICENSE)). Il s'appuie sur les logiciels
tiers ci-dessous. Les composants marqués ⚠ sont **copyleft ou à source disponible** (pas open source
au sens de l'OSI) — voir la note de compatibilité qui suit.

### Plateforme et infrastructure (déployés comme services / images)

| Composant | Rôle dans Falcone | Licence (SPDX) | Lien |
| --- | --- | --- | --- |
| PostgreSQL 16 (+ pgvector) | Datastore principal du tenant ; isolation RLS + schéma par tenant ; pgvector pour la recherche vectorielle | `PostgreSQL` | [postgresql.org](https://www.postgresql.org/about/licence/) · [pgvector](https://github.com/pgvector/pgvector) |
| FerretDB v2 (sur DocumentDB / PostgreSQL 17) | API de données documentaires — compatible avec le wire protocol de MongoDB ([ADR-14](docs-site/architecture/adrs.md)) | `Apache-2.0` (gateway) + `MIT` (extension DocumentDB) | [ferretdb](https://github.com/FerretDB/FerretDB) · [documentdb](https://github.com/microsoft/documentdb) |
| Redpanda 24.2 | Bus d'événements compatible Kafka / streaming CDC | ⚠ `BSL-1.1` (Redpanda) + `RCL` | [licenses](https://github.com/redpanda-data/redpanda/tree/dev/licenses) |
| SeaweedFS 4.33 | Stockage d'objets compatible S3 ([ADR-13](docs-site/architecture/adrs.md)) | `Apache-2.0` | [seaweedfs](https://github.com/seaweedfs/seaweedfs) |
| OpenBao 2.3.1 | Gestion des secrets | `MPL-2.0` | [LICENSE](https://github.com/openbao/openbao/blob/main/LICENSE) |
| Keycloak 26 | IAM avec realm par tenant / OIDC | `Apache-2.0` | [keycloak](https://github.com/keycloak/keycloak) |
| Apache APISIX 3.9 | API gateway (surface publique `/v1`) | `Apache-2.0` | [apisix](https://github.com/apache/apisix) |
| Temporal (serveur 1.25 + SDK TypeScript 1.18) | Moteur de workflows durables derrière Flows | `MIT` | [temporal](https://github.com/temporalio/temporal) · [sdk-typescript](https://github.com/temporalio/sdk-typescript) |
| Knative Serving + Kourier | Runtime de fonctions serverless | `Apache-2.0` | [serving](https://github.com/knative/serving) · [net-kourier](https://github.com/knative-extensions/net-kourier) |
| Kubernetes + Helm | Déploiement et orchestration | `Apache-2.0` | [kubernetes](https://github.com/kubernetes/kubernetes) · [helm](https://github.com/helm/helm) |
| Node.js 22 | Runtime des services | `MIT` | [nodejs](https://github.com/nodejs/node) |
| nginx | Service statique de l'image de la console web | `BSD-2-Clause` | [nginx.org](https://nginx.org/LICENSE) |

### Principaux frameworks et bibliothèques applicatifs (npm)

| Composant | Rôle dans Falcone | Licence (SPDX) | Lien |
| --- | --- | --- | --- |
| React 18 | UI de la console web | `MIT` | [react](https://github.com/facebook/react) |
| Vite | Build et serveur de dev de la console | `MIT` | [vite](https://github.com/vitejs/vite) |
| TypeScript | Code typé (console, workflow worker) | `Apache-2.0` | [TypeScript](https://github.com/microsoft/TypeScript) |
| Tailwind CSS | Styles de la console | `MIT` | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| React Flow (`@xyflow/react`) | Canevas du concepteur visuel de Flows | `MIT` | [xyflow](https://github.com/xyflow/xyflow) |
| Monaco Editor (+ `monaco-yaml`) | Édition de code / YAML dans la console | `MIT` | [monaco-editor](https://github.com/microsoft/monaco-editor) |
| node-postgres (`pg`) | Client PostgreSQL | `MIT` | [node-postgres](https://github.com/brianc/node-postgres) |
| MongoDB Node Driver (`mongodb`) | Client de la base documentaire — wire protocol de MongoDB (MongoDB / FerretDB) | `Apache-2.0` | [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) |
| KafkaJS | Client Kafka / Redpanda | `MIT` | [kafkajs](https://github.com/tulios/kafkajs) |
| AWS SDK for JS v3 (`@aws-sdk/client-s3`) | Client de stockage d'objets S3 (SeaweedFS) | `Apache-2.0` | [aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| jose + jwks-rsa | Validation JWT / JWKS | `MIT` | [jose](https://github.com/panva/jose) · [node-jwks-rsa](https://github.com/auth0/node-jwks-rsa) |
| ws | Passerelle temps réel WebSocket | `MIT` | [ws](https://github.com/websockets/ws) |
| Ajv | Validation JSON Schema | `MIT` | [ajv](https://github.com/ajv-validator/ajv) |
| cel-js | Évaluation d'expressions de capacité / politique | `MIT` | [cel-js](https://www.npmjs.com/package/cel-js) |
| Playwright | Tests E2E sur stack réelle | `Apache-2.0` | [playwright](https://github.com/microsoft/playwright) |

> [!IMPORTANT]
> **Compatibilité des licences — revue nécessaire.** Le code propre de Falcone est sous **MIT**, ce
> qui est compatible avec l'utilisation de tous les composants permissifs ci-dessus (MIT,
> Apache-2.0, ISC, BSD, PostgreSQL). Les composants ⚠ ne sont **pas** open source au sens de l'OSI
> et méritent une revue :
> - **Redpanda (`BSL-1.1` + `RCL`)** est à source disponible.
>   Les anciennes dépendances **MongoDB (`SSPL-1.0`)** et **MinIO (`AGPL-3.0`)** ont été **supprimées**
>   — remplacées respectivement par **FerretDB** (`Apache-2.0`, [ADR-14](docs-site/architecture/adrs.md))
>   et **SeaweedFS** (`Apache-2.0`, [ADR-13](docs-site/architecture/adrs.md)), retirant ainsi leur
>   exposition SSPL/AGPL.
> - L'exécuter comme **service d'appui séparé avec lequel Falcone communique par le réseau**
>   n'impose pas, en soi, sa licence au code MIT de Falcone (pas de liaison / d'œuvre dérivée).
>   **Mais** ses clauses « offre en tant que service » / « service concurrent » sont directement
>   pertinentes pour un BaaS multitenant qui **réexpose** ses fonctionnalités aux tenants — une API
>   Kafka/événements. En particulier, la concession BSL de Redpanda exclut les offres
>   gérées concurrentes. Examinez ces termes avant toute offre hébergée ou commerciale ; Redpanda est
>   remplaçable au niveau du déploiement si ses termes ne conviennent pas à votre usage.
> - **Stockage d'objets : MinIO → SeaweedFS (Apache-2.0).** Conformément à
>   [ADR-13](docs-site/architecture/adrs.md), **SeaweedFS** est le stockage d'objets, choisi
>   spécifiquement pour retirer l'exposition de l'**article 13 de l'AGPL** « offre en tant que
>   service » de MinIO pour un BaaS qui réexpose S3 aux tenants. L'ancienne dépendance MinIO a été
>   supprimée.
> - **Base documentaire : MongoDB → FerretDB + DocumentDB (Apache-2.0 + MIT).** Conformément à
>   [ADR-14](docs-site/architecture/adrs.md), **FerretDB v2** sur un moteur DocumentDB / PostgreSQL
>   est la base documentaire, retirant l'exposition de l'**article 13 de la SSPL** de MongoDB.
>   FerretDB conserve le pilote MongoDB et le wire protocol inchangés ; l'ancienne dépendance serveur
>   MongoDB a été supprimée.

**Non exhaustif.** Ce tableau liste les composants tiers **principaux**, pas l'arbre complet des
dépendances transitives (les utilitaires mineurs — `undici`, `clsx`, `lucide-react`, `uuid`,
`cron-parser`, `js-yaml`, etc. — sont omis). Pour une vue complète, générez un SBOM / rapport de
licences — p. ex. `license-checker` ou `pnpm licenses list` pour les workspaces npm — et, si des
composants Python ou Go sont ajoutés plus tard, `pip-licenses` et `go-licenses` respectivement.
Examinez la sortie avant toute distribution.

---

## Licence

Voir [LICENSE](./LICENSE).
