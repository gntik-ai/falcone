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

# Server deps (pg for the DI Pool; JWT/JWKS verification is dependency-free via node:crypto).
COPY deploy/kind/control-plane/package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && ln -sfn /app/node_modules /node_modules

# Server source + domain-B modules + the verified runtime route table.
COPY deploy/kind/control-plane/server.mjs deploy/kind/control-plane/routes.mjs \
     deploy/kind/control-plane/jwt-verify.mjs \
     deploy/kind/control-plane/kc-admin.mjs deploy/kind/control-plane/tenant-store.mjs \
     deploy/kind/control-plane/b-handlers.mjs deploy/kind/control-plane/auth-handlers.mjs \
     deploy/kind/control-plane/saga.mjs deploy/kind/control-plane/dataplane.mjs \
     deploy/kind/control-plane/schema-retry.mjs deploy/kind/control-plane/tenant-scope.mjs \
     deploy/kind/control-plane/governance-schema.mjs deploy/kind/control-plane/workspace-quota.mjs \
     deploy/kind/control-plane/metrics-handlers.mjs deploy/kind/control-plane/metrics-registry.mjs \
     deploy/kind/control-plane/storage-handlers.mjs deploy/kind/control-plane/seaweedfs-identity.mjs \
     deploy/kind/control-plane/mongo-handlers.mjs deploy/kind/control-plane/pg-handlers.mjs \
     deploy/kind/control-plane/kafka-handlers.mjs \
     deploy/kind/control-plane/fn-handlers.mjs deploy/kind/control-plane/function-executor.mjs \
     deploy/kind/control-plane/vault-secrets.mjs \
     deploy/kind/control-plane/audit-store.mjs deploy/kind/control-plane/audit-writer.mjs \
     deploy/kind/control-plane/audit-hash.mjs \
     deploy/kind/control-plane/route-map.runtime.json ./

# Backend action modules consumed at runtime (resolved under /repo). Copy the
# services whose actions the route table dispatches to, plus internal-contracts
# (shared) and apps/control-plane (IAM/console modules). Add more dirs as
# families are wired.
COPY services/provisioning-orchestrator /repo/services/provisioning-orchestrator
COPY services/internal-contracts        /repo/services/internal-contracts
COPY services/scheduling-engine         /repo/services/scheduling-engine
COPY apps/control-plane                 /repo/apps/control-plane

# Fail the BUILD if the route map references a handler module the image did not COPY
# (fix-scheduling-handler-dockerfile): `/v1/scheduling/*` dispatched to
# /repo/services/scheduling-engine/... which was never COPY'd, so every scheduling
# request 500'd with ERR_MODULE_NOT_FOUND at runtime. This static check turns a
# missing COPY into a build failure instead of a runtime 500.
RUN node -e "const fs=require('fs');const list=JSON.parse(fs.readFileSync('./route-map.runtime.json','utf8'));const mods=[...new Set(list.filter(r=>typeof r.module==='string').map(r=>r.module))];const miss=mods.filter(p=>!fs.existsSync(p));if(miss.length){console.error('[build] route map references missing handler modules:\n  '+miss.join('\n  '));process.exit(1)}console.log('[build] all '+mods.length+' route handler modules resolve')"

ENV NODE_ENV=production
USER 1000
EXPOSE 8080
CMD ["node", "server.mjs"]
