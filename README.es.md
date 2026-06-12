<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>Una plataforma Backend-as-a-Service (BaaS) multitenant.</strong>

  <p>Bases de datos, almacenamiento, autenticación, eventos, tiempo real y funciones serverless — aisladas por tenant, gobernadas por planes y cuotas, detrás de una sola API.</p>

  <sub>

  [English](./README.md) ·
  **Español** ·
  [Français](./README.fr.md) ·
  [Deutsch](./README.de.md) ·
  [中文](./README.zh.md) ·
  [Русский](./README.ru.md)

  </sub>
</div>

---

## El principio detrás de Falcone

Casi todos los productos necesitan la misma fontanería de backend: una base de
datos, almacenamiento de archivos, autenticación de usuarios, trabajos en segundo
plano, un bus de eventos, actualizaciones en tiempo real. Construir y operar esa
fontanería **una vez por aplicación — y de nuevo para cada cliente —** es donde los
equipos pierden tiempo y donde nacen los incidentes de seguridad.

Falcone existe para resolver eso una sola vez. Es un **BaaS multitenant**: una
única plataforma que sirve a muchos tenants aislados, cada uno con sus propios
datos, identidades y recursos, expuestos a través de una API consistente.

Dos ideas sostienen todo el sistema:

1. **El aislamiento de tenants es el contrato, no una característica.**
   Cada lectura y cada escritura se acotan por `tenant_id` (y, un nivel más abajo,
   por `workspace_id`). La identidad se resuelve en el borde a partir de un token,
   se propaga como un contexto explícito a través del gateway, los servicios, la
   capa de datos y los trabajos en segundo plano, y se aplica en la base de datos
   con seguridad a nivel de fila y esquemas por tenant. La fuga entre tenants se
   trata como el error cardinal.

2. **Las capacidades se otorgan por plan y se aplican en todas partes.**
   Lo que un tenant puede hacer — SQL, tiempo real, webhooks, funciones, Kafka,
   almacenamiento — es la intersección de su **plan comercial**, el **perfil de
   despliegue** y el **entorno**. El gateway controla las rutas según esas claves de
   capacidad, las cuotas limitan el consumo por tenant/workspace, y cada denegación
   queda auditada.

El resultado es una plataforma donde un cliente obtiene un backend completo en
minutos, y el operador mantiene una única superficie gobernable y observable — en
lugar de una flota de backends hechos a mano.

### Cómo encaja todo

```
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API Gateway (APISIX)   /v1   idempotencia, CORS, │
                    resuelve tenant ▸ inyecta identidad, correlation │
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
   │ PostgreSQL (RLS + esquema por tenant) · MongoDB · Kafka · S3/MinIO ·     │
   │ Vault (secretos) · Keycloak (IAM realm por tenant)                       │
   └────────────────────────────────────────────────────────────────────────┘
```

La plataforma es un **monorepo pnpm + Turbo** de servicios Node.js (módulos ES) y
una consola web React + Vite, desplegada con Helm en Kubernetes y servida tras un
gateway APISIX.

---

## Capacidades

| Dominio | Lo que ofrece a un tenant |
| --- | --- |
| **Ciclo de vida del tenant** | Crear, suspender, eliminar (soft-delete) y purgar tenants mediante una máquina de estados protegida (`draft → provisioning → active → suspended → soft_deleted`), con paneles de gobernanza y doble confirmación en acciones destructivas. |
| **Saga de aprovisionamiento** | Orquestación asíncrona que levanta (o desmonta) un tenant en cada dominio — realm IAM, namespace Kafka, esquema Postgres, MongoDB, namespace de almacenamiento, namespace de funciones — con verificaciones previas y rollback ante fallos. |
| **Workspaces** | Fronteras sub-tenant con su propio slug, entorno, alcance IAM y membresía. Clonado de workspaces con políticas explícitas; resolución de herencia de recursos compartidos vs. especializados. |
| **Autenticación e IAM** | Login de consola delegado por OIDC, registro con activación pendiente, recuperación de contraseña. Administración Keycloak (realm por tenant) de realms, clientes, roles, scopes y usuarios. Validación de JWT vía JWKS en caché con introspección de respaldo. |
| **Cuentas de servicio y apps OAuth2** | Clientes OAuth2 y cuentas de servicio con API-key por workspace, con validación de URI de redirección HTTPS y límites según el plan. |
| **PostgreSQL** | API de datos acotada por tenant más administración/gobernanza, captura de cambios (CDC), métricas y auditoría. Aislamiento por seguridad a nivel de fila (`app.tenant_id` / `app.workspace_id`) y esquemas por tenant. |
| **MongoDB** | API de documentos por tenant/workspace, administración, change streams, métricas y auditoría. |
| **Almacenamiento de objetos** | Buckets compatibles con S3, cargas multipart, URLs prefirmadas, políticas de acceso, notificaciones de eventos y cuotas de capacidad por tenant. |
| **Eventos (Kafka)** | Gestión de topics y change streams CDC acotados por tenant (`<prefijo>.<tenant>.<workspace>`), más topics de sistema de auditoría/cuota/ciclo de vida. |
| **Tiempo real** | Suscripciones WebSocket (`/v1/websockets`) con autenticación Bearer-JWT, aplicación de scope a canal y aislamiento de tenant por sesión. |
| **Funciones** | Funciones serverless con versiones, activaciones, invocaciones, rollback y disparadores cron / Kafka / almacenamiento. |
| **Webhooks** | Entrega de webhooks firmada y con reintentos, con protección SSRF (rangos privados, loopback, link-local y ULA bloqueados, revalidados en el momento de la entrega). |
| **Programación** | Trabajos cron con cuotas de concurrencia y de número de trabajos por workspace y auditoría completa de ejecución. |
| **Planes y cuotas** | Los planes comerciales se asocian a claves de capacidad, valores por defecto de cuota y un perfil de despliegue. Las cuotas aplican modos hard-block / soft-grace / soft-exhausted por tenant y workspace. |
| **Copia de seguridad y restauración** | Listado de snapshots, orquestación de restauración y simulación de recuperación a un punto en el tiempo (PITR) sobre adaptadores S3 / Postgres / Mongo. |
| **Observabilidad y auditoría** | Pipeline de auditoría por tenant (actor, sobre de alcance, recurso, acción, resultado) transmitido a Kafka y persistido, con familias de métricas, health checks, paneles y alertas de umbral. |
| **API gateway** | Una única superficie pública en `/v1` con claves de idempotencia requeridas, correlation IDs, validación de solicitudes y timeouts/reintentos por ruta. |
| **Consola web** | UI de administración React + Vite para tenants, workspaces, miembros, bases de datos, almacenamiento, funciones, eventos, planes, cuotas y observabilidad. |

---

## QuickStart con Docker Compose

El repositorio incluye un stack de Compose que levanta los **servicios reales de
respaldo** con los que habla Falcone — PostgreSQL, Keycloak, Redpanda (Kafka),
MongoDB (replica set de un nodo), MinIO (S3) y Vault — más un gateway APISIX y un
action runner. Es la forma más rápida de tener un entorno funcional en tu máquina.

### Requisitos previos

- Docker con el plugin Compose (`docker compose`)
- Node.js 20+ y `pnpm` (vía `corepack enable`) — solo necesario para ejecutar las suites

### 1. Clonar e instalar

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
corepack enable
pnpm install
```

### 2. Levantar el stack con Docker Compose

El script auxiliar configura los health checks, las migraciones, el replica set de
Mongo, el bucket de MinIO y el dispositivo de auditoría de Vault por ti:

```bash
cd tests/env
./up.sh
```

…o usa Compose directamente si solo quieres los contenedores:

```bash
docker compose -f tests/env/docker-compose.yml up -d --build
docker compose -f tests/env/docker-compose.yml ps
```

### 3. Servicios y puertos

| Servicio | URL / endpoint | Credenciales |
| --- | --- | --- |
| API gateway (APISIX) | http://localhost:9080 | Bearer JWT de Keycloak |
| Keycloak (IdP) | http://localhost:8081 | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| MongoDB (rs0) | `localhost:57017` | — |
| Redpanda (Kafka) | `localhost:19092` | — |
| MinIO (API S3) | http://localhost:59000 | `minioadmin` / `minioadmin` |
| Consola MinIO | http://localhost:59001 | `minioadmin` / `minioadmin` |
| Vault (dev) | http://localhost:58200 | token `root` |

### 4. Pruébalo

```bash
# Ejecuta las suites unit / contract / e2e contra el stack en vivo
pnpm test

# o la suite de contrato black-box (solo interfaz pública)
bash tests/blackbox/run.sh
```

### 5. Desmóntalo

```bash
cd tests/env
./down.sh
# o: docker compose -f tests/env/docker-compose.yml down -v
```

> Para un despliegue de grado producción completo (runtime de funciones, el
> control-plane y la consola web), usa los charts de Helm bajo `helm/` y `charts/`
> en un clúster de Kubernetes — consulta los manifiestos en `deploy/`.

---

## Estructura del repositorio

```
apps/            control-plane (superficie API REST) · web-console (UI React)
services/        gateway-config, realtime-gateway, webhook-engine, cdc-bridges,
                 scheduling-engine, provisioning-orchestrator, backup-status,
                 audit, adapters, internal-contracts, …
charts/ helm/    Despliegue Kubernetes / Helm
deploy/          Rutas APISIX, bootstrap kind/OpenShift
tests/           blackbox (contrato) · e2e (Playwright) · env (stack Compose)
openspec/        Flujo de cambios dirigido por especificaciones
```

---

## Licencia

Consulta [LICENSE](./LICENSE).
