# Temporal DSL interpreter worker (change: add-flows-dsl-interpreter-worker / #359).
#
# Built from the REPO ROOT so workspace deps resolve, consistent with
# apps/control-plane/Dockerfile:
#   docker build -f services/workflow-worker/Dockerfile -t in-falcone-workflow-worker:0.1.0 .
#
# Two stages: (1) compile TypeScript → dist/ (CommonJS) with dev deps, then (2) a slim
# runtime image with only production deps and the compiled dist/, running as USER node.
# @temporalio/core-bridge ships a glibc native binary; Alpine (musl) cannot load it.
# Use node:22-slim (Debian Bookworm slim) which provides glibc. Both stages must match.
FROM node:22-slim AS build
WORKDIR /app/services/workflow-worker

# Install ALL deps (incl. typescript) for the tsc compile.
COPY services/workflow-worker/package.json ./package.json
RUN npm install --no-package-lock

# Compile.
COPY services/workflow-worker/tsconfig.json ./tsconfig.json
COPY services/workflow-worker/src ./src
COPY services/workflow-worker/scripts ./scripts
RUN npm run build

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /app/services/workflow-worker

# Production deps only.
COPY services/workflow-worker/package.json ./package.json
RUN npm install --omit=dev --no-package-lock

# Compiled output.
COPY --from=build /app/services/workflow-worker/dist ./dist

# The ssrf.mjs activity imports isBlockedIp from services/webhook-engine/src/webhook-subscription.mjs
# via a relative path (../../../webhook-engine/src/...). The entire webhook-engine/src/ must live at
# the same path relative to the dist/ directory as it does in the repo workspace, because
# webhook-subscription.mjs itself imports from event-catalogue.mjs in the same directory.
COPY services/webhook-engine/src /app/services/webhook-engine/src

# worker-deps.mjs (fix-flows-worker-db-activity-wiring / #563) dynamically imports the
# postgres executor (apps/control-plane/src/runtime/) and its plan-builder adapter
# (services/adapters/src/). These paths must be reachable relative to dist/worker.js:
#   dist/worker.js  →  ../../../apps/control-plane/src/runtime/*.mjs   ✓
#   apps/control-plane/src/runtime/postgres-data-executor.mjs imports:
#       ../../../../services/adapters/src/postgresql-data-api.mjs     ✓
COPY apps/control-plane/src/runtime/connection-registry.mjs \
     apps/control-plane/src/runtime/postgres-data-executor.mjs \
     apps/control-plane/src/runtime/workspace-dsn-resolver.mjs \
     apps/control-plane/src/runtime/errors.mjs \
     /app/apps/control-plane/src/runtime/
COPY services/adapters/src/postgresql-data-api.mjs \
     services/adapters/src/postgresql-governance-admin.mjs \
     /app/services/adapters/src/

ENV NODE_ENV=production \
    TEMPORAL_ADDRESS=temporal-frontend:7233 \
    TEMPORAL_NAMESPACE=falcone-flows \
    TEMPORAL_TASK_QUEUE=flows-main \
    WORKER_HEALTH_PORT=8080

EXPOSE 8080
USER node
CMD ["node", "dist/worker.js"]
