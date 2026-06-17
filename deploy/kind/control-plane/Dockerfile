# Control-plane runtime image for the kind deploy.
# BUILD CONTEXT = repo root (so it can COPY the backend action modules):
#   docker build -f deploy/kind/control-plane/Dockerfile -t <ref> .
#
# The server (server.mjs) validates the Keycloak JWT and dispatches /v1/* to the
# repo's real action modules under /repo. Bare imports inside those modules
# (e.g. `pg`) resolve via the /node_modules symlink -> /app/node_modules
# (Node's ESM resolver walks up to the filesystem root from /repo).
FROM node:22-alpine
WORKDIR /app

# Server deps (pg for the DI Pool, jose for JWKS verification).
COPY deploy/kind/control-plane/package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && ln -sfn /app/node_modules /node_modules

# Server source + domain-B modules + the verified runtime route table.
COPY deploy/kind/control-plane/server.mjs deploy/kind/control-plane/routes.mjs \
     deploy/kind/control-plane/kc-admin.mjs deploy/kind/control-plane/tenant-store.mjs \
     deploy/kind/control-plane/b-handlers.mjs deploy/kind/control-plane/auth-handlers.mjs \
     deploy/kind/control-plane/saga.mjs deploy/kind/control-plane/dataplane.mjs \
     deploy/kind/control-plane/metrics-handlers.mjs deploy/kind/control-plane/metrics-registry.mjs \
     deploy/kind/control-plane/storage-handlers.mjs \
     deploy/kind/control-plane/mongo-handlers.mjs deploy/kind/control-plane/pg-handlers.mjs \
     deploy/kind/control-plane/kafka-handlers.mjs \
     deploy/kind/control-plane/fn-handlers.mjs deploy/kind/control-plane/function-executor.mjs \
     deploy/kind/control-plane/route-map.runtime.json ./

# Backend action modules consumed at runtime (resolved under /repo). Copy the
# services whose actions the route table dispatches to, plus internal-contracts
# (shared) and apps/control-plane (IAM/console modules). Add more dirs as
# families are wired.
COPY services/provisioning-orchestrator /repo/services/provisioning-orchestrator
COPY services/internal-contracts        /repo/services/internal-contracts
COPY apps/control-plane                 /repo/apps/control-plane

ENV NODE_ENV=production
USER 1000
EXPOSE 8080
CMD ["node", "server.mjs"]
