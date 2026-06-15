# Control-plane executor service (change: add-control-plane-executor).
# Build from the REPO ROOT so the executor's relative import of the adapter plan
# builders (apps/control-plane/src/runtime -> ../../../../services/adapters/src) resolves:
#   docker build -f apps/control-plane/Dockerfile -t in-falcone-control-plane:0.7.0 .
FROM node:22-alpine

WORKDIR /app

# Install runtime deps at /app/node_modules so they are accessible from ALL paths
# under /app (including services/internal-contracts, services/webhook-engine, etc.
# which are copied as sibling directories and may import shared packages).
# Node ESM resolution walks UP from the importing file's directory; placing
# node_modules at /app ensures it is reached regardless of which sub-tree the
# import originates from.
COPY apps/control-plane/package.json /app/package.json
RUN npm install --omit=dev --no-package-lock

# App sources + the adapter plan-builder layer the executor imports. The Mongo data
# adapter loads internal-contracts (JSON read at runtime), so ship that src too.
# The flows-related modules import from:
#   - services/workflow-worker/src/activities/catalog-names.mjs (task-type names)
#   - services/audit/src/flow-lifecycle-events.mjs (lifecycle event builder)
#   - services/webhook-engine/src/ (webhook signing)
COPY apps/control-plane/src /app/apps/control-plane/src
COPY services/adapters/src /app/services/adapters/src
COPY services/internal-contracts/src /app/services/internal-contracts/src
# Realtime executor (add-ferretdb-realtime-cdc-remediation #460) imports the shared logical-
# replication modules (WalReplicationClient/CollectionCatalog/provisionLogicalReplication) from the
# CDC bridge. Node resolves their deps (pg-logical-replication, bson — declared in this image's
# package.json) from /app/node_modules via the upward walk.
COPY services/mongo-cdc-bridge/src /app/services/mongo-cdc-bridge/src
COPY services/workflow-worker/src/activities/catalog-names.mjs /app/services/workflow-worker/src/activities/catalog-names.mjs
COPY services/audit/src /app/services/audit/src
COPY services/webhook-engine/src /app/services/webhook-engine/src

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080
USER node
WORKDIR /app/apps/control-plane
CMD ["node", "src/runtime/main.mjs"]
