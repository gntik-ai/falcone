<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>一个多租户的后端即服务（BaaS）平台。</strong>

  <p>数据库、存储、认证、事件、实时通信与无服务器函数——按租户隔离，由套餐与配额治理，统一对外提供一套 API。</p>

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

```
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API 网关 (APISIX)   /v1   幂等、CORS、           │
                    解析租户 ▸ 注入身份、关联 ID (correlation-id)     │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 249+ 个 REST 端点         │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ mongo · storage · events · functions ·    │
                        │ metrics · plans · quotas · backup         │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   （Saga、appliers）          scheduling-engine / backup-status   (pg & mongo → Kafka)
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL（RLS + 按租户 schema）· MongoDB · Kafka · S3/MinIO ·          │
   │ Vault（密钥）· Keycloak（按租户 realm 的 IAM）                            │
   └────────────────────────────────────────────────────────────────────────┘
```

该平台是一个 **pnpm + Turbo 单仓库（monorepo）**，由若干 Node.js（ES 模块）服务与一个 React + Vite
Web 控制台组成，通过 Helm 部署到 Kubernetes，并由 APISIX 网关对外承接流量。

---

## 能力

| 领域 | 它为租户提供什么 |
| --- | --- |
| **租户生命周期** | 通过受保护的状态机（`draft → provisioning → active → suspended → soft_deleted`）创建、暂停、软删除与彻底清除租户，配有治理仪表盘，破坏性操作需双重确认。 |
| **预配 Saga** | 异步编排，在每个领域上为租户搭建（或拆除）资源——IAM realm、Kafka namespace、Postgres schema、MongoDB、存储 namespace、函数 namespace——含预检与失败回滚。 |
| **工作区（Workspaces）** | 子租户边界，拥有各自的 slug、环境、IAM 范围与成员关系。可按显式策略克隆工作区；解析共享 vs. 专属资源的继承关系。 |
| **认证与 IAM** | OIDC 委托的控制台登录、带待激活状态的注册、密码找回。基于 Keycloak（按租户 realm）管理 realm、客户端、角色、scope 与用户。通过缓存的 JWKS 校验 JWT，并回退到 introspection。 |
| **服务账号与 OAuth2 应用** | 按工作区的 OAuth2 客户端与 API Key 服务账号，含 HTTPS 重定向 URI 校验与套餐强制的数量上限。 |
| **PostgreSQL** | 按租户限定的数据 API，外加管理/治理、变更数据捕获（CDC）、指标与审计。通过行级安全（`app.tenant_id` / `app.workspace_id`）与按租户 schema 实现隔离。 |
| **MongoDB** | 按租户/工作区的文档数据 API、管理、变更流（change streams）、指标与审计。 |
| **对象存储** | 兼容 S3 的存储桶、分片上传、预签名 URL、访问策略、事件通知与按租户的容量配额。 |
| **事件（Kafka）** | Topic 管理与按租户限定的 CDC 变更流（`<前缀>.<租户>.<工作区>`），以及审计/配额/生命周期等系统 topic。 |
| **实时** | WebSocket 订阅（`/v1/websockets`），采用 Bearer-JWT 认证、scope 到 channel 的强制校验，以及按会话的租户隔离。 |
| **函数** | 无服务器函数，支持版本、激活、调用、回滚，以及 cron / Kafka / 存储 触发器。 |
| **Webhook** | 带签名与重试的 Webhook 投递，具备 SSRF 防护（私有、回环、链路本地与 ULA 地址段被阻断，并在投递时刻再次校验）。 |
| **调度** | Cron 任务，按工作区设置并发与任务数配额，并提供完整的执行审计。 |
| **套餐与配额** | 商业套餐映射到能力键、配额默认值与一个部署画像。配额按租户与工作区执行 hard-block / soft-grace / soft-exhausted 模式。 |
| **备份与恢复** | 快照列举、恢复编排，以及基于 S3 / Postgres / Mongo 适配器的时间点恢复（PITR）模拟。 |
| **可观测性与审计** | 按租户的审计管线（执行者、范围信封、资源、操作、结果）流式写入 Kafka 并持久化，配有指标族、健康检查、仪表盘与阈值告警。 |
| **API 网关** | 统一对外的 `/v1` 面，强制要求幂等键、关联 ID、请求校验，以及按路由的超时/重试。 |
| **Web 控制台** | React + Vite 管理界面，覆盖租户、工作区、成员、数据库、存储、函数、事件、套餐、配额与可观测性。 |

---

## 使用 Docker Compose 快速开始

仓库自带一套 Compose 栈，用于启动 Falcone 所依赖的 **真实后端服务**——PostgreSQL、Keycloak、
Redpanda（Kafka）、MongoDB（单节点副本集）、MinIO（S3）与 Vault——外加一个 APISIX 网关与一个 action runner。
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

辅助脚本会为你配置健康检查、数据库迁移、Mongo 副本集、MinIO 存储桶与 Vault 审计设备：

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
| API 网关（APISIX） | http://localhost:9080 | 来自 Keycloak 的 Bearer JWT |
| Keycloak（IdP） | http://localhost:8081 | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| MongoDB（rs0） | `localhost:57017` | — |
| Redpanda（Kafka） | `localhost:19092` | — |
| MinIO（S3 API） | http://localhost:59000 | `minioadmin` / `minioadmin` |
| MinIO 控制台 | http://localhost:59001 | `minioadmin` / `minioadmin` |
| Vault（dev） | http://localhost:58200 | 令牌 `root` |

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

```
apps/            control-plane（REST API 面）· web-console（React UI）
services/        gateway-config、realtime-gateway、webhook-engine、cdc-bridges、
                 scheduling-engine、provisioning-orchestrator、backup-status、
                 audit、adapters、internal-contracts ……
charts/ helm/    Kubernetes / Helm 部署
deploy/          APISIX 路由、kind/OpenShift 引导
tests/           blackbox（契约）· e2e（Playwright）· env（Compose 栈）
openspec/        规格驱动的变更工作流
```

---

## 许可证

参见 [LICENSE](./LICENSE)。
