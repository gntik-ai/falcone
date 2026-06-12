<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>Une plateforme Backend-as-a-Service (BaaS) multitenant.</strong>

  <p>Bases de données, stockage, authentification, événements, temps réel et fonctions serverless — isolés par tenant, gouvernés par des plans et des quotas, derrière une seule API.</p>

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

```
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API Gateway (APISIX)   /v1   idempotence, CORS,  │
                    résout le tenant ▸ injecte identité, correlation │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 249+ endpoints REST      │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ mongo · storage · events · functions ·    │
                        │ metrics · plans · quotas · backup         │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   (sagas, appliers)           scheduling-engine / backup-status   (pg & mongo → Kafka)
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL (RLS + schéma par tenant) · MongoDB · Kafka · S3/MinIO ·      │
   │ Vault (secrets) · Keycloak (IAM realm par tenant)                        │
   └────────────────────────────────────────────────────────────────────────┘
```

La plateforme est un **monorepo pnpm + Turbo** de services Node.js (modules ES) et
une console web React + Vite, déployée avec Helm sur Kubernetes et placée derrière
une passerelle APISIX.

---

## Capacités

| Domaine | Ce que cela offre à un tenant |
| --- | --- |
| **Cycle de vie du tenant** | Créer, suspendre, supprimer (soft-delete) et purger des tenants via une machine à états protégée (`draft → provisioning → active → suspended → soft_deleted`), avec des tableaux de bord de gouvernance et une double confirmation pour les actions destructrices. |
| **Saga de provisionnement** | Orchestration asynchrone qui met en place (ou démonte) un tenant dans chaque domaine — realm IAM, namespace Kafka, schéma Postgres, MongoDB, namespace de stockage, namespace de fonctions — avec contrôles préalables et rollback en cas d'échec. |
| **Workspaces** | Frontières sub-tenant avec leur propre slug, environnement, périmètre IAM et adhésion. Clonage de workspaces avec des politiques explicites ; résolution de l'héritage de ressources partagées vs. spécialisées. |
| **Authentification & IAM** | Connexion console déléguée OIDC, inscription avec activation en attente, récupération de mot de passe. Administration Keycloak (realm par tenant) des realms, clients, rôles, scopes et utilisateurs. Validation JWT via JWKS en cache avec repli sur introspection. |
| **Comptes de service & apps OAuth2** | Clients OAuth2 et comptes de service à clé API par workspace, avec validation des URI de redirection HTTPS et limites imposées par le plan. |
| **PostgreSQL** | API de données délimitée par tenant plus administration/gouvernance, capture de changements (CDC), métriques et audit. Isolation par sécurité au niveau des lignes (`app.tenant_id` / `app.workspace_id`) et schémas par tenant. |
| **MongoDB** | API de documents par tenant/workspace, administration, change streams, métriques et audit. |
| **Stockage d'objets** | Buckets compatibles S3, uploads multipart, URLs présignées, politiques d'accès, notifications d'événements et quotas de capacité par tenant. |
| **Événements (Kafka)** | Gestion des topics et change streams CDC délimités par tenant (`<préfixe>.<tenant>.<workspace>`), plus topics système d'audit/quota/cycle de vie. |
| **Temps réel** | Abonnements WebSocket (`/v1/websockets`) avec authentification Bearer-JWT, application du scope au canal et isolation du tenant par session. |
| **Fonctions** | Fonctions serverless avec versions, activations, invocations, rollback et déclencheurs cron / Kafka / stockage. |
| **Webhooks** | Livraison de webhooks signée et avec retries, avec protection SSRF (plages privées, loopback, link-local et ULA bloquées, revérifiées au moment de la livraison). |
| **Planification** | Tâches cron avec quotas de concurrence et de nombre de tâches par workspace et audit complet de l'exécution. |
| **Plans & quotas** | Les plans commerciaux correspondent à des clés de capacité, des valeurs de quota par défaut et un profil de déploiement. Les quotas appliquent des modes hard-block / soft-grace / soft-exhausted par tenant et workspace. |
| **Sauvegarde & restauration** | Listing des snapshots, orchestration de la restauration et simulation de récupération à un point dans le temps (PITR) sur les adaptateurs S3 / Postgres / Mongo. |
| **Observabilité & audit** | Pipeline d'audit par tenant (acteur, enveloppe de portée, ressource, action, résultat) diffusé vers Kafka et persisté, avec familles de métriques, health checks, tableaux de bord et alertes de seuil. |
| **API gateway** | Une surface publique unique sur `/v1` avec clés d'idempotence requises, correlation IDs, validation des requêtes et timeouts/retries par route. |
| **Console web** | UI d'administration React + Vite pour tenants, workspaces, membres, bases de données, stockage, fonctions, événements, plans, quotas et observabilité. |

---

## Démarrage rapide avec Docker Compose

Le dépôt fournit une stack Compose qui démarre les **vrais services d'appui** avec
lesquels Falcone communique — PostgreSQL, Keycloak, Redpanda (Kafka), MongoDB
(replica set à un nœud), MinIO (S3) et Vault — plus une passerelle APISIX et un
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

Le script utilitaire configure pour vous les health checks, les migrations, le
replica set Mongo, le bucket MinIO et le dispositif d'audit Vault :

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
| API gateway (APISIX) | http://localhost:9080 | Bearer JWT de Keycloak |
| Keycloak (IdP) | http://localhost:8081 | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| MongoDB (rs0) | `localhost:57017` | — |
| Redpanda (Kafka) | `localhost:19092` | — |
| MinIO (API S3) | http://localhost:59000 | `minioadmin` / `minioadmin` |
| Console MinIO | http://localhost:59001 | `minioadmin` / `minioadmin` |
| Vault (dev) | http://localhost:58200 | token `root` |

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

```
apps/            control-plane (surface API REST) · web-console (UI React)
services/        gateway-config, realtime-gateway, webhook-engine, cdc-bridges,
                 scheduling-engine, provisioning-orchestrator, backup-status,
                 audit, adapters, internal-contracts, …
charts/ helm/    Déploiement Kubernetes / Helm
deploy/          Routes APISIX, bootstrap kind/OpenShift
tests/           blackbox (contrat) · e2e (Playwright) · env (stack Compose)
openspec/        Flux de changements piloté par les spécifications
```

---

## Licence

Voir [LICENSE](./LICENSE).
