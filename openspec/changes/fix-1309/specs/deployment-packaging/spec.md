## MODIFIED Requirements

### Requirement: Enabled mode creates one source build per released service

When enabled with a Git URI and webhook Secret reference, the chart SHALL render
exactly one Docker-strategy BuildConfig and one ImageStream for each released
catalog service: `control-plane`, `control-plane-executor`, `web-console`,
`workflow-worker`, `mcp-runtime`, and `fn-runtime`. Each BuildConfig SHALL use its
catalog Dockerfile path, configured Git ref and optional same-Project source
Secret, output tag, a `ConfigChange` trigger, and a secret-referenced GitLab trigger.

BuildConfig resource requirements SHALL remain configurable. The default common
memory request and limit SHALL remain `128Mi` and `1Gi`. Only the web-console
BuildConfig SHALL merge a `512Mi` request and `4Gi` limit, paired with a 3072 MiB
Node heap for each Vite build. Runtime pod resources and schema shape SHALL remain
unchanged.

#### Scenario: Install starts all initial builds

- **WHEN** the enabled resources are first created
- **THEN** exactly six ConfigChange-caused Builds start and target the six corresponding stream tags

#### Scenario: Web console receives its build budget

- **WHEN** enabled resources are rendered with default resource values
- **THEN** five BuildConfigs receive the common `128Mi`/`1Gi` memory budget and web-console receives the merged `512Mi`/`4Gi` budget

#### Scenario: Web console override remains isolated

- **WHEN** web-console's BuildConfig memory limit is overridden to `5Gi`
- **THEN** only that BuildConfig receives the override and the other five retain `128Mi`/`1Gi`

#### Scenario: Enabled configuration lacks required references

- **WHEN** the mode is enabled without either `git.uri` or `webhookSecret`
- **THEN** Helm rejects the configuration before resources are installed

### Requirement: Released source Dockerfiles build from the repository root

Released service Dockerfiles SHALL build from a clean repository-root Docker
context without requiring a pre-generated host artifact, while preserving their
numeric-non-root runtime contracts. The web-console builder SHALL retain exactly
three RUN instructions: locked dependency installation, legacy Vite build, and
next Vite build. Both Vite RUN instructions SHALL use
`NODE_OPTIONS=--max-old-space-size=3072`.

#### Scenario: Web console source build

- **WHEN** OpenShift builds `apps/web-console/Dockerfile` from a clean monorepo checkout
- **THEN** the locked pnpm builder produces both console bundles in separate 3072 MiB heap-capped RUN layers and copies them into the runtime without builder dependencies

#### Scenario: Insufficient heap or combined layer regression

- **WHEN** either Vite RUN instruction is changed to a 512, 768, or 1536 MiB heap, or installation and a build share one RUN instruction
- **THEN** the Dockerfile contract rejects each regression independently

#### Scenario: Function runtime source build

- **WHEN** OpenShift builds `apps/fn-runtime/Dockerfile` from the monorepo root
- **THEN** the tracked `apps/fn-runtime/server.mjs` is copied into the final numeric-non-root image
