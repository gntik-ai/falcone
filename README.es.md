<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>Una plataforma Backend-as-a-Service (BaaS) multitenant.</strong>

  <p>Bases de datos, almacenamiento, autenticación, eventos, tiempo real y funciones serverless — aisladas por tenant, gobernadas por planes y cuotas, detrás de una sola API.</p>

  <p>
    <img alt="Estado: desarrollo temprano" src="https://img.shields.io/badge/status-early%20development-orange" />
    <img alt="No apto para producción" src="https://img.shields.io/badge/production-not%20ready-critical" />
    <img alt="Licencia: MIT" src="https://img.shields.io/badge/license-MIT-blue" />
  </p>

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

> [!WARNING]
> **Falcone no está listo para producción.** Está en desarrollo temprano y activo.
> Las APIs públicas, los esquemas de datos y el comportamiento en ejecución pueden cambiar en
> cualquier momento, sin previo aviso ni ruta de migración. En esta etapa **no hay garantías de
> estabilidad, seguridad ni soporte**, y el proyecto no ha pasado por una auditoría de seguridad.
> **No ejecutes Falcone para cargas de trabajo de producción ni le confíes datos sensibles.** Úsalo
> solo para evaluación, experimentación y desarrollo.

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

## Pensado para la IA: un BaAIS

Falcone parte de donde lo hace cualquier plataforma de backend — datos, autenticación,
almacenamiento, eventos y funciones multitenant detrás de una sola API — y lo orienta hacia cómo se
construye y se opera el software cada vez más: **por, y para, agentes de IA.**

Llamamos a esta categoría un **BaAIS** — un *Backend-as-an-AI-Service*, un juego de palabras sobre
"BaaS" para un mundo nativo de IA. (La expansión es deliberadamente flexible; lo que importa es la
dirección, no el acrónimo.) En concreto, "pensado para la IA" significa que el backend de un tenant
está diseñado para ser **consumible de forma nativa por agentes**, no solo por código de aplicación:

- **Hosting de servidores MCP** *(en desarrollo)* — los tenants podrán exponer su backend (datos,
  almacenamiento, funciones) como un servidor [Model Context Protocol](https://modelcontextprotocol.io),
  para que cualquier agente compatible con MCP pueda descubrirlo e invocarlo bajo el aislamiento, la
  autenticación y las cuotas propias de ese tenant.
- **Flujos agénticos** — el motor **Flows**, basado en Temporal, permite a los tenants definir
  flujos de trabajo duraderos y de varios pasos a partir de un DSL con JSON Schema, con un catálogo
  de actividades de primera parte cuyas credenciales están acotadas por tenant — el sustrato fiable
  que un agente necesita para actuar entre servicios.

Todo lo que un agente toca permanece dentro del mismo contrato que el resto de la plataforma:
acotado por tenant y workspace, controlado por las capacidades del plan, y auditado.

---

## Hoja de ruta

Falcone es pre-1.0 y avanza rápido; esto es la dirección a corto plazo, no un compromiso.

- **Hosting de servidores MCP** — *en desarrollo activo.* Permitir que los tenants expongan y
  alojen servidores [Model Context Protocol](https://modelcontextprotocol.io) para que sus backends
  sean accesibles por agentes de IA, bajo aislamiento, autenticación y cuotas por tenant.
- **Flows — motor de flujos de trabajo duraderos (Temporal)** — *en progreso* ([épica #355](https://github.com/gntik-ai/falcone/issues/355)).
  Flujos definidos por el tenant mediante un DSL con JSON Schema y un worker intérprete, un catálogo
  de actividades de primera parte con credenciales acotadas por tenant, disparadores (Temporal
  Schedules, webhooks, eventos de plataforma) y un diseñador visual en la consola web.
- **Hacia una primera versión estable** — *planificado.* Revisión de seguridad, garantías de
  estabilidad de API/esquemas y herramientas de migración (véase el aviso al inicio).

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
| **Flows (motor de flujos de trabajo)** | Flujos de trabajo duraderos definidos por el tenant sobre un motor basado en Temporal: un DSL con JSON Schema y un worker intérprete, un catálogo de actividades de primera parte con credenciales acotadas por tenant, disparadores (schedules, webhooks, eventos de plataforma) y un diseñador visual en la consola. *En desarrollo activo ([épica #355](https://github.com/gntik-ai/falcone/issues/355)).* |
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

## Software de terceros y licencias

El propio Falcone tiene **licencia MIT** (véase [LICENSE](./LICENSE)). Se apoya en el software de
terceros que se indica a continuación. Los componentes marcados con ⚠ son **copyleft o de código
disponible** (no son open source según la OSI) — véase la nota de compatibilidad posterior.

### Plataforma e infraestructura (desplegados como servicios / imágenes)

| Componente | Función en Falcone | Licencia (SPDX) | Enlace |
| --- | --- | --- | --- |
| PostgreSQL 16 (+ pgvector) | Almacén de datos principal del tenant; aislamiento RLS + esquema por tenant; pgvector para búsqueda vectorial | `PostgreSQL` | [postgresql.org](https://www.postgresql.org/about/licence/) · [pgvector](https://github.com/pgvector/pgvector) |
| MongoDB Server 7 | API de datos de documentos por tenant/workspace | ⚠ `SSPL-1.0` | [mongodb.com](https://www.mongodb.com/legal/licensing/community-edition) |
| Redpanda 24.2 | Bus de eventos compatible con Kafka / streaming CDC | ⚠ `BSL-1.1` (Redpanda) + `RCL` | [licenses](https://github.com/redpanda-data/redpanda/tree/dev/licenses) |
| MinIO | Almacenamiento de objetos compatible con S3 | ⚠ `AGPL-3.0` | [LICENSE](https://github.com/minio/minio/blob/master/LICENSE) |
| HashiCorp Vault 1.18 | Gestión de secretos | ⚠ `BUSL-1.1` | [LICENSE](https://github.com/hashicorp/vault/blob/main/LICENSE) |
| Keycloak 26 | IAM con realm por tenant / OIDC | `Apache-2.0` | [keycloak](https://github.com/keycloak/keycloak) |
| Apache APISIX 3.9 | API gateway (superficie pública `/v1`) | `Apache-2.0` | [apisix](https://github.com/apache/apisix) |
| Temporal (servidor 1.25 + SDK de TypeScript 1.18) | Motor de flujos de trabajo duraderos detrás de Flows | `MIT` | [temporal](https://github.com/temporalio/temporal) · [sdk-typescript](https://github.com/temporalio/sdk-typescript) |
| Knative Serving + Kourier | Runtime de funciones serverless | `Apache-2.0` | [serving](https://github.com/knative/serving) · [net-kourier](https://github.com/knative-extensions/net-kourier) |
| Apache OpenWhisk | Motor de funciones heredado / opcional | `Apache-2.0` | [openwhisk](https://github.com/apache/openwhisk) |
| Kubernetes + Helm | Despliegue y orquestación | `Apache-2.0` | [kubernetes](https://github.com/kubernetes/kubernetes) · [helm](https://github.com/helm/helm) |
| Node.js 22 | Runtime de los servicios | `MIT` | [nodejs](https://github.com/nodejs/node) |
| nginx | Servido estático de la imagen de la consola web | `BSD-2-Clause` | [nginx.org](https://nginx.org/LICENSE) |

### Principales frameworks y librerías de aplicación (npm)

| Componente | Función en Falcone | Licencia (SPDX) | Enlace |
| --- | --- | --- | --- |
| React 18 | UI de la consola web | `MIT` | [react](https://github.com/facebook/react) |
| Vite | Build y servidor de desarrollo de la consola | `MIT` | [vite](https://github.com/vitejs/vite) |
| TypeScript | Código tipado (consola, workflow worker) | `Apache-2.0` | [TypeScript](https://github.com/microsoft/TypeScript) |
| Tailwind CSS | Estilos de la consola | `MIT` | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| React Flow (`@xyflow/react`) | Lienzo del diseñador visual de Flows | `MIT` | [xyflow](https://github.com/xyflow/xyflow) |
| Monaco Editor (+ `monaco-yaml`) | Edición de código / YAML en la consola | `MIT` | [monaco-editor](https://github.com/microsoft/monaco-editor) |
| node-postgres (`pg`) | Cliente de PostgreSQL | `MIT` | [node-postgres](https://github.com/brianc/node-postgres) |
| MongoDB Node Driver (`mongodb`) | Cliente de MongoDB | `Apache-2.0` | [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) |
| KafkaJS | Cliente de Kafka / Redpanda | `MIT` | [kafkajs](https://github.com/tulios/kafkajs) |
| AWS SDK for JS v3 (`@aws-sdk/client-s3`) | Cliente de S3 / MinIO | `Apache-2.0` | [aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| jose + jwks-rsa | Validación de JWT / JWKS | `MIT` | [jose](https://github.com/panva/jose) · [node-jwks-rsa](https://github.com/auth0/node-jwks-rsa) |
| ws | Gateway de tiempo real WebSocket | `MIT` | [ws](https://github.com/websockets/ws) |
| Ajv | Validación de JSON Schema | `MIT` | [ajv](https://github.com/ajv-validator/ajv) |
| cel-js | Evaluación de expresiones de capacidad / política | `MIT` | [cel-js](https://www.npmjs.com/package/cel-js) |
| Playwright | Tests E2E sobre stack real | `Apache-2.0` | [playwright](https://github.com/microsoft/playwright) |

> [!IMPORTANT]
> **Compatibilidad de licencias — requiere revisión.** El propio código de Falcone es **MIT**, que
> es compatible con el uso de todos los componentes permisivos anteriores (MIT, Apache-2.0, ISC,
> BSD, PostgreSQL). Los componentes ⚠ **no** son open source según la OSI y merecen revisión:
> - **MongoDB (`SSPL-1.0`)**, **MinIO (`AGPL-3.0`)**, **Redpanda (`BSL-1.1` + `RCL`)** y
>   **Vault (`BUSL-1.1`)** son copyleft o de código disponible.
> - Ejecutarlos como **servicios de respaldo separados con los que Falcone se comunica por red** no
>   impone, por sí mismo, su licencia al código MIT de Falcone (sin enlazado / obra derivada). **Pero**
>   sus cláusulas de "ofrecer como servicio" / "servicio competidor" son directamente relevantes para
>   un BaaS multitenant que **reexpone** su funcionalidad a los tenants — una API de datos de Mongo,
>   una API de Kafka/eventos, una API de almacenamiento S3. En particular, **la §13 de SSPL y la §13
>   de AGPL apuntan a ofrecer la funcionalidad del software como servicio**, y las concesiones BSL de
>   Redpanda/Vault excluyen las ofertas gestionadas competidoras. Revisa estos términos antes de
>   cualquier oferta alojada o comercial. Los cuatro son intercambiables en la capa de despliegue si
>   sus términos no encajan con tu caso de uso.

**No exhaustivo.** Esta tabla enumera los componentes de terceros **principales**, no el árbol
completo de dependencias transitivas (se omiten utilidades menores — `undici`, `clsx`,
`lucide-react`, `uuid`, `cron-parser`, `js-yaml`, etc.). Para una visión completa, genera un SBOM /
informe de licencias — p. ej. `license-checker` o `pnpm licenses list` para los workspaces de
npm — y, si más adelante se añaden componentes de Python o Go, `pip-licenses` y `go-licenses`
respectivamente. Revisa la salida antes de distribuir.

---

## Licencia

Consulta [LICENSE](./LICENSE).
