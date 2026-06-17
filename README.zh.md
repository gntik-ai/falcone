<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>一个多租户的后端即服务（BaaS）平台。</strong>

  <p>数据库、存储、认证、事件、实时通信与无服务器函数——按租户隔离，由套餐与配额治理，统一对外提供一套 API。</p>

  <p>
    <img alt="状态：早期开发" src="https://img.shields.io/badge/status-early%20development-orange" />
    <img alt="未达到生产可用" src="https://img.shields.io/badge/production-not%20ready-critical" />
    <img alt="许可证：MIT" src="https://img.shields.io/badge/license-MIT-blue" />
  </p>

  <sub>

  [English](./README.md) ·
  [Español](./README.es.md) ·
  [Français](./README.fr.md) ·
  [Deutsch](./README.de.md) ·
  **中文** ·
  [Русский](./README.ru.md)

  </sub>
</div>

---

> [!WARNING]
> **Falcone 尚未达到生产可用。** 项目正处于早期、活跃的开发阶段。
> 公共 API、数据 schema 与运行时行为可能随时变更，恕不另行通知，也不保证迁移路径。现阶段
> **不对稳定性、安全性或支持作任何保证**，且项目尚未经过安全审计。
> **请勿将 Falcone 用于生产负载，也不要托付敏感数据。** 仅用于评估、试验与开发。

---

## Falcone 背后的理念

几乎每个产品都需要相同的后端基础设施：一个数据库、文件存储、用户认证、后台任务、事件总线、实时更新。
**为每个应用构建并运维这套基础设施一次——再为每个客户重复一次——** 正是团队浪费时间、并孕育安全事故的地方。

Falcone 的存在就是为了一次性解决这个问题。它是一个 **多租户 BaaS**：用一套平台服务众多彼此隔离的租户，
每个租户拥有自己的数据、身份与资源，并通过一套一致的 API 对外暴露。

两个核心理念支撑着整个系统：

1. **租户隔离是契约，而非功能。**
   每一次读写都按 `tenant_id` 限定范围（再往下一层按 `workspace_id`）。身份在边缘从令牌解析得出，
   作为显式上下文贯穿网关、各服务、数据层与后台任务，并在数据库层通过行级安全（RLS）与按租户分库分模式（schema）强制执行。
   跨租户数据泄露被视为最严重的缺陷。

2. **能力按套餐授予，并在各处强制执行。**
   一个租户能做什么——SQL、实时、Webhook、函数、Kafka、存储——取决于其 **商业套餐**、**部署画像** 与
   **运行环境** 三者的交集。网关依据这些能力键（capability key）对路由进行准入控制，配额按租户/工作区限制消耗，
   且每一次拒绝都会被审计记录。

最终成果是这样一个平台：客户在几分钟内即可获得一个完整的后端，而运营方维护的是一个统一、可治理、可观测的面，
而不是一支手工拼凑的后端"舰队"。

### 整体架构如何组合

```text
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API 网关 (APISIX)   /v1   幂等、CORS、           │
                    解析租户 ▸ 注入身份、关联 ID (correlation-id)     │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 250+ 个 REST 端点         │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ documents · storage · events · functions ·│
                        │ metrics · plans · quotas · backup ·       │
                        │ flows (/v1/flows) · MCP (/v1/mcp) [Prev.] │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   （Saga、appliers）          scheduling-engine / backup-status   (pg & documents → Kafka)
                               workflow-worker（Flows 解释器）
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL（RLS + 按租户 schema）· FerretDB+DocumentDB · Kafka · SeaweedFS · │
   │ Vault（密钥）· Keycloak（按租户 realm 的 IAM + 面向 MCP 的 OAuth 2.1）·   │
   │ Temporal（Flows 引擎）· Knative（functions + 按租户 MCP 运行时）          │
   └────────────────────────────────────────────────────────────────────────┘
```

该平台是一个 **pnpm + Turbo 单仓库（monorepo）**，由若干 Node.js（ES 模块）服务与一个 React + Vite
Web 控制台组成，通过 Helm 部署到 Kubernetes，并由 APISIX 网关对外承接流量。

---

## 为 AI 而生：一个 BaAIS

Falcone 起步于任何后端平台的同一处——多租户的数据、认证、存储、事件与函数，统一在一套 API 之后——
并将其对准软件日益被构建与运维的方式：**由 AI 代理（agent）使用，也为 AI 代理而建。**

我们把这一品类称为 **BaAIS**——即 *Backend-as-an-AI-Service*，是对 “BaaS” 在 AI 原生时代的一个文字
游戏。（其全称刻意保持宽松；重要的是方向，而非这个缩写。）具体而言，“为 AI 而生” 意味着租户的后端被
设计为可**被代理原生地消费**，而不仅仅供应用代码调用：

- **MCP 服务器托管** *(Preview)*——租户把自己的后端（数据、存储、函数）以
  [Model Context Protocol](https://modelcontextprotocol.io) 服务器的形式对外暴露，使任何兼容 MCP 的
  代理都能在该租户自身的隔离、认证与配额之下发现并调用它。管理 API 已在 `/v1/mcp` 上实时提供；
  Instant MCP 与官方服务器已端到端可用。
- **代理式工作流（Agentic workflows）** *(Preview)*——基于 Temporal 的 **Flows** 引擎让租户可以用 JSON Schema
  DSL 定义持久化的多步骤工作流，并配有凭据按租户隔离的第一方活动目录（activity catalog）——这正是代理
  跨服务可靠行动所需的基座。

代理所触及的一切都停留在与平台其余部分相同的契约之内：按租户与工作区限定范围、受套餐能力的准入控制，
并被审计记录。

---

## 路线图

Falcone 仍处于 1.0 之前且推进很快；以下是近期方向，并非承诺。

**已发布（Preview）。** 两项面向 AI 的旗舰能力均已落地并完成文档；在上文“尚未达到生产可用”的前提下，
它们仍标记为 Preview：

- **MCP 服务器托管** —— 管理 API 已在 `/v1/mcp` 上实时提供；**Instant MCP** 与**官方服务器**端到端可用
  （创建 → 策展 → 发布 → 调用 → 观测），具备按租户隔离、OAuth、配额、注册表/版本管理与审计。服务器状态
  目前为内存内（单副本）。（[epic #386](https://github.com/gntik-ai/falcone/issues/386)）
- **Flows —— 持久化工作流引擎（Temporal）** —— 由租户通过 JSON Schema DSL 与解释器 worker 定义的工作流，
  凭据按租户隔离的第一方活动目录，触发器以及可视化设计器。（[epic #355](https://github.com/gntik-ai/falcone/issues/355)）

**进行中 / 计划中。**

- **MCP 后续增量** —— 持久化（基于 Postgres）的多副本服务器注册表；在实时创建路径上支持自定义（自带镜像）
  托管；接通 workflows-as-MCP-tools；以及按服务器的直连 MCP 协议（目前由 control-plane 中转工具调用）。
- **对象存储 —— MinIO → SeaweedFS（已完成）。** **SeaweedFS**（Apache-2.0）即为对象存储
  （[ADR-13](docs-site/architecture/adrs.md)），由 umbrella chart 部署并默认启用；原先的 MinIO `storage`
  组件已被移除。参见 [SeaweedFS 存储运行手册](docs-site/architecture/seaweedfs.md)。
- **文档存储 —— MongoDB → FerretDB + DocumentDB（已完成）。** **FerretDB v2**（Apache-2.0，兼容 MongoDB
  wire 协议）运行在 **DocumentDB / PostgreSQL** 引擎（MIT）之上，即为文档存储
  （[ADR-14](docs-site/architecture/adrs.md#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)），
  由 umbrella chart 部署；原先的 MongoDB 服务器组件已被移除。MongoDB 驱动、wire 协议与 Mongo 风格的数据
  API 保持不变。参见 [FerretDB 文档存储运行手册](docs-site/architecture/ferretdb.md)。
- **迈向首个稳定版本** —— *计划中。* 安全审计、API/schema 稳定性保证，以及迁移工具（参见顶部的提示）。

---

## 能力

| 领域 | 它为租户提供什么 |
| --- | --- |
| **租户生命周期** | 通过受保护的状态机（`draft → provisioning → active → suspended → soft_deleted`）创建、暂停、软删除与彻底清除租户，配有治理仪表盘，破坏性操作需双重确认。 |
| **预配 Saga** | 异步编排，在每个领域上为租户搭建（或拆除）资源——IAM realm、Kafka namespace、Postgres schema、文档存储（FerretDB/DocumentDB）、存储 namespace、函数 namespace——含预检与失败回滚。 |
| **工作区（Workspaces）** | 子租户边界，拥有各自的 slug、环境、IAM 范围与成员关系。可按显式策略克隆工作区；解析共享 vs. 专属资源的继承关系。 |
| **认证与 IAM** | OIDC 委托的控制台登录、带待激活状态的注册、密码找回。基于 Keycloak（按租户 realm）管理 realm、客户端、角色、scope 与用户。通过缓存的 JWKS 校验 JWT，并回退到 introspection。 |
| **服务账号与 OAuth2 应用** | 按工作区的 OAuth2 客户端与 API Key 服务账号，含 HTTPS 重定向 URI 校验与套餐强制的数量上限。 |
| **PostgreSQL** | 按租户限定的数据 API，外加管理/治理、变更数据捕获（CDC）、指标与审计。通过行级安全（`app.tenant_id` / `app.workspace_id`）与按租户 schema 实现隔离。 |
| **文档存储（FerretDB + DocumentDB）** | 按租户/工作区的文档数据 API、管理、实时/CDC（Postgres 逻辑复制）、指标与审计。兼容 MongoDB wire 协议；取代 MongoDB（ADR-14）。 |
| **对象存储** | 兼容 S3 的存储桶、分片上传、预签名 URL、访问策略、事件通知与按租户的容量配额。 |
| **事件（Kafka）** | Topic 管理与按租户限定、由 PostgreSQL 逻辑复制驱动的 CDC 数据流（`<前缀>.<租户>.<工作区>`），以及审计/配额/生命周期等系统 topic。 |
| **实时** | WebSocket 订阅（`/v1/websockets`），采用 Bearer-JWT 认证、scope 到 channel 的强制校验，以及按会话的租户隔离。 |
| **函数** | 无服务器函数，支持版本、激活、调用、回滚，以及 cron / Kafka / 存储 触发器。 |
| **Webhook** | 带签名与重试的 Webhook 投递，具备 SSRF 防护（私有、回环、链路本地与 ULA 地址段被阻断，并在投递时刻再次校验）。 |
| **调度** | Cron 任务，按工作区设置并发与任务数配额，并提供完整的执行审计。 |
| **Flows（工作流引擎）** | 由租户在基于 Temporal 的引擎上定义的持久化工作流：JSON Schema DSL 与解释器 worker、凭据按租户隔离的第一方活动目录、触发器（schedules、Webhook、平台事件），以及控制台中的可视化设计器。*Preview（[epic #355](https://github.com/gntik-ai/falcone/issues/355)）。* |
| **MCP 服务器托管** | 托管租户的 Model Context Protocol 服务器，使 AI 代理把后端作为工具调用。管理 API 已在 `/v1/mcp` 上实时提供：Instant MCP（从资源生成工具）、官方 read-first 服务器、强制策展、带防“rug-pull”审查的注册表/版本管理、OAuth 2.1、按租户的配额/限流与审计。*Preview —— Instant MCP + 官方服务器已实时可用（内存内状态）；自定义镜像托管与 workflows-as-tools 为实验性（[epic #386](https://github.com/gntik-ai/falcone/issues/386)）。* |
| **套餐与配额** | 商业套餐映射到能力键、配额默认值与一个部署画像。配额按租户与工作区执行 hard-block / soft-grace / soft-exhausted 模式。 |
| **备份与恢复** | 快照列举、恢复编排，以及基于 S3 / Postgres / Mongo 适配器的时间点恢复（PITR）模拟。 |
| **可观测性与审计** | 按租户的审计管线（执行者、范围信封、资源、操作、结果）流式写入 Kafka 并持久化，配有指标族、健康检查、仪表盘与阈值告警。 |
| **API 网关** | 统一对外的 `/v1` 面，强制要求幂等键、关联 ID、请求校验，以及按路由的超时/重试。 |
| **Web 控制台** | React + Vite 管理界面，覆盖租户、工作区、成员、数据库、存储、函数、事件、套餐、配额与可观测性。 |

---

## 使用 Docker Compose 快速开始

仓库自带一套 Compose 栈，用于启动 Falcone 所依赖的 **真实后端服务**——PostgreSQL、Keycloak、
Redpanda（Kafka）、FerretDB + DocumentDB（兼容 MongoDB wire 协议的文档存储）、SeaweedFS（S3）与 Vault——外加一个 APISIX 网关与一个 action runner。
这是在本机获得可用环境最快的方式。

### 前置条件

- 安装了 Compose 插件的 Docker（`docker compose`）
- Node.js 20+ 与 `pnpm`（通过 `corepack enable`）——仅在运行测试套件时需要

### 1. 克隆并安装

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
corepack enable
pnpm install
```

### 2. 用 Docker Compose 启动整套栈

辅助脚本会为你配置健康检查、数据库迁移、FerretDB + DocumentDB 文档存储、SeaweedFS 存储桶与 Vault 审计设备：

```bash
cd tests/env
./up.sh
```

……如果你只想要容器，也可以直接驱动 Compose：

```bash
docker compose -f tests/env/docker-compose.yml up -d --build
docker compose -f tests/env/docker-compose.yml ps
```

### 3. 服务与端口

| 服务 | URL / 端点 | 凭据 |
| --- | --- | --- |
| API 网关（APISIX） | <http://localhost:9080> | 来自 Keycloak 的 Bearer JWT |
| Keycloak（IdP） | <http://localhost:8081> | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| FerretDB gateway (MongoDB wire) | `localhost:57017` | `falcone` / `falcone` |
| Redpanda（Kafka） | `localhost:19092` | — |
| SeaweedFS（S3 API） | <http://localhost:58333> | S3 访问密钥 / 私钥（path-style） |
| Vault（dev） | <http://localhost:58200> | 令牌 `root` |

### 4. 上手验证

```bash
# 针对运行中的栈执行 unit / contract / e2e 测试套件
pnpm test

# 或仅面向公共接口的黑盒契约套件
bash tests/blackbox/run.sh
```

### 5. 关停清理

```bash
cd tests/env
./down.sh
# 或：docker compose -f tests/env/docker-compose.yml down -v
```

> 若需完整的生产级部署（函数运行时、control-plane 与 Web 控制台），请在 Kubernetes 集群上使用 `helm/`
> 与 `charts/` 下的 Helm chart——参见 `deploy/` 中的清单文件。

---

## 仓库结构

```text
apps/            control-plane（REST API 面）· web-console（React UI）·
                 cli（falcone CLI：mcp init/dev/deploy）· mcp-server-sdk（按租户隔离的 MCP 工具 SDK）
services/        gateway-config、realtime-gateway、webhook-engine、cdc-bridges、
                 scheduling-engine、provisioning-orchestrator、backup-status、
                 workflow-worker（Flows DSL 解释器）、audit、adapters、
                 internal-contracts ……
charts/ helm/    Kubernetes / Helm 部署（含 temporal、workflowWorker、mcp 组件）
deploy/          APISIX 路由、kind/OpenShift 引导
tests/           blackbox（契约）· e2e（Playwright，含 mcp 规格）· env（Compose 栈）
openspec/        规格驱动的变更工作流
```

---

## 第三方软件与许可证

Falcone 自身采用 **MIT 许可证**（参见 [LICENSE](./LICENSE)）。它构建在下列第三方软件之上。标记为 ⚠
的组件为 **copyleft 或源代码可得（source-available）**（并非 OSI 认可的开源）——请参阅随后的兼容性
说明。

### 平台与基础设施（以服务 / 镜像形式部署）

| 组件 | 在 Falcone 中的作用 | 许可证（SPDX） | 链接 |
| --- | --- | --- | --- |
| PostgreSQL 16（+ pgvector） | 租户的主数据存储；RLS + 按租户 schema 隔离；pgvector 用于向量检索 | `PostgreSQL` | [postgresql.org](https://www.postgresql.org/about/licence/) · [pgvector](https://github.com/pgvector/pgvector) |
| FerretDB v2（基于 DocumentDB / PostgreSQL 17） | 文档数据 API —— 兼容 MongoDB wire 协议（[ADR-14](docs-site/architecture/adrs.md)） | `Apache-2.0`（gateway） + `MIT`（DocumentDB 扩展） | [ferretdb](https://github.com/FerretDB/FerretDB) · [documentdb](https://github.com/microsoft/documentdb) |
| Redpanda 24.2 | 兼容 Kafka 的事件总线 / CDC 流式传输 | ⚠ `BSL-1.1`（Redpanda） + `RCL` | [licenses](https://github.com/redpanda-data/redpanda/tree/dev/licenses) |
| SeaweedFS 4.33 | 兼容 S3 的对象存储（[ADR-13](docs-site/architecture/adrs.md)） | `Apache-2.0` | [seaweedfs](https://github.com/seaweedfs/seaweedfs) |
| HashiCorp Vault 1.18 | 密钥管理 | ⚠ `BUSL-1.1` | [LICENSE](https://github.com/hashicorp/vault/blob/main/LICENSE) |
| Keycloak 26 | 按租户 realm 的 IAM / OIDC | `Apache-2.0` | [keycloak](https://github.com/keycloak/keycloak) |
| Apache APISIX 3.9 | API 网关（对外 `/v1` 面） | `Apache-2.0` | [apisix](https://github.com/apache/apisix) |
| Temporal（服务端 1.25 + TypeScript SDK 1.18） | Flows 背后的持久化工作流引擎 | `MIT` | [temporal](https://github.com/temporalio/temporal) · [sdk-typescript](https://github.com/temporalio/sdk-typescript) |
| Knative Serving + Kourier | 无服务器函数运行时 | `Apache-2.0` | [serving](https://github.com/knative/serving) · [net-kourier](https://github.com/knative-extensions/net-kourier) |
| Kubernetes + Helm | 部署与编排 | `Apache-2.0` | [kubernetes](https://github.com/kubernetes/kubernetes) · [helm](https://github.com/helm/helm) |
| Node.js 22 | 服务运行时 | `MIT` | [nodejs](https://github.com/nodejs/node) |
| nginx | Web 控制台镜像的静态资源服务 | `BSD-2-Clause` | [nginx.org](https://nginx.org/LICENSE) |

### 主要应用框架与库（npm）

| 组件 | 在 Falcone 中的作用 | 许可证（SPDX） | 链接 |
| --- | --- | --- | --- |
| React 18 | Web 控制台 UI | `MIT` | [react](https://github.com/facebook/react) |
| Vite | 控制台构建与开发服务器 | `MIT` | [vite](https://github.com/vitejs/vite) |
| TypeScript | 带类型的源码（控制台、workflow worker） | `Apache-2.0` | [TypeScript](https://github.com/microsoft/TypeScript) |
| Tailwind CSS | 控制台样式 | `MIT` | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| React Flow（`@xyflow/react`） | Flows 可视化设计器画布 | `MIT` | [xyflow](https://github.com/xyflow/xyflow) |
| Monaco Editor（+ `monaco-yaml`） | 控制台内的代码 / YAML 编辑 | `MIT` | [monaco-editor](https://github.com/microsoft/monaco-editor) |
| node-postgres（`pg`） | PostgreSQL 客户端 | `MIT` | [node-postgres](https://github.com/brianc/node-postgres) |
| MongoDB Node Driver（`mongodb`） | 文档存储客户端 —— MongoDB wire 协议（MongoDB / FerretDB） | `Apache-2.0` | [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) |
| KafkaJS | Kafka / Redpanda 客户端 | `MIT` | [kafkajs](https://github.com/tulios/kafkajs) |
| AWS SDK for JS v3（`@aws-sdk/client-s3`） | S3 对象存储客户端（SeaweedFS） | `Apache-2.0` | [aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| jose + jwks-rsa | JWT / JWKS 校验 | `MIT` | [jose](https://github.com/panva/jose) · [node-jwks-rsa](https://github.com/auth0/node-jwks-rsa) |
| ws | WebSocket 实时网关 | `MIT` | [ws](https://github.com/websockets/ws) |
| Ajv | JSON Schema 校验 | `MIT` | [ajv](https://github.com/ajv-validator/ajv) |
| cel-js | 能力 / 策略表达式求值 | `MIT` | [cel-js](https://www.npmjs.com/package/cel-js) |
| Playwright | 真实栈 E2E 测试 | `Apache-2.0` | [playwright](https://github.com/microsoft/playwright) |

> [!IMPORTANT]
> **许可证兼容性 —— 需要审阅。** Falcone 自身的代码为 **MIT**，与使用上述所有宽松许可的组件（MIT、
> Apache-2.0、ISC、BSD、PostgreSQL）兼容。标记为 ⚠ 的组件**并非** OSI 认可的开源，值得审阅：
> - **Redpanda（`BSL-1.1` + `RCL`）** 与 **Vault（`BUSL-1.1`）** 属于 copyleft 或源代码可得
>   （source-available）。原先的 **MongoDB（`SSPL-1.0`）** 与 **MinIO（`AGPL-3.0`）** 依赖已被**移除**——
>   分别由 **FerretDB**（`Apache-2.0`，[ADR-14](docs-site/architecture/adrs.md)）与
>   **SeaweedFS**（`Apache-2.0`，[ADR-13](docs-site/architecture/adrs.md)）取代，从而消除了它们的
>   SSPL/AGPL 风险敞口。
> - 将它们作为 **Falcone 通过网络与之通信的独立后端服务** 来运行，本身并不会把它们的许可证强加到
>   Falcone 的 MIT 代码上（不存在链接 / 衍生作品）。**但是**，它们的 “以服务形式提供” / “竞争性服务”
>   条款，对一个**再次对租户暴露**其功能的多租户 BaaS 是直接相关的——比如 Kafka/事件 API。特别是，
>   Redpanda/Vault 的 BSL 授权排除了竞争性的托管服务。在任何托管或商业化提供之前，请审阅这些条款。
>   若其条款不适合你的用例，这两者都可在部署层替换。
> - **对象存储：MinIO → SeaweedFS（Apache-2.0）。** 依据
>   [ADR-13](docs-site/architecture/adrs.md)，**SeaweedFS** 即为对象存储，专门为消除 MinIO 的
>   **AGPL 第 13 条** “以服务形式提供” 风险而选定——面向一个再次对租户暴露 S3 的 BaaS。原先的 MinIO 依赖
>   已被移除。
> - **文档存储：MongoDB → FerretDB + DocumentDB（Apache-2.0 + MIT）。** 依据
>   [ADR-14](docs-site/architecture/adrs.md)，运行在 DocumentDB / PostgreSQL 引擎之上的 **FerretDB v2**
>   即为文档存储，从而消除了 MongoDB 的 **SSPL 第 13 条** 风险敞口。FerretDB 保持 MongoDB 驱动与 wire 协议
>   不变；原先的 MongoDB 服务器依赖已被移除。

**并非详尽清单。** 此表仅列出**主要的**第三方组件，并非完整的传递依赖树（省略了较小的工具库——
`undici`、`clsx`、`lucide-react`、`uuid`、`cron-parser`、`js-yaml` 等）。如需完整视图，请生成
SBOM / 许可证报告——例如对 npm 工作区使用 `license-checker` 或 `pnpm licenses list`——并在日后加入
Python 或 Go 组件时，分别使用 `pip-licenses` 与 `go-licenses`。分发前请审阅其输出。

---

## 许可证

参见 [LICENSE](./LICENSE)。
