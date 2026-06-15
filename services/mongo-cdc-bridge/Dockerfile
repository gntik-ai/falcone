# Mongo CDC bridge — re-architected onto Postgres logical replication
# (add-ferretdb-realtime-cdc-remediation #460). FerretDB v2 has no change streams, so the bridge
# consumes a pgoutput logical replication slot on the DocumentDB engine and publishes CloudEvents to
# Kafka. Build from the REPO ROOT so the cross-package import of the CloudEvents builder
# (src/MongoChangeEventMapper.mjs -> ../../provisioning-orchestrator/src/...) resolves:
#   docker build -f services/mongo-cdc-bridge/Dockerfile -t in-falcone-mongo-cdc-bridge:1.0.0 .
FROM node:22-alpine

WORKDIR /app

# Runtime deps at /app/node_modules so Node ESM resolution reaches them via the upward walk from
# any copied sub-tree (the bridge src and the provisioning-orchestrator model live as siblings).
COPY services/mongo-cdc-bridge/package.json /app/package.json
RUN npm install --omit=dev --no-package-lock

# Bridge sources + the only cross-package module they import (the CloudEvents envelope builder,
# which itself only uses node:crypto).
COPY services/mongo-cdc-bridge/src /app/services/mongo-cdc-bridge/src
COPY services/provisioning-orchestrator/src/models/realtime /app/services/provisioning-orchestrator/src/models/realtime

ENV NODE_ENV=production
USER node
WORKDIR /app/services/mongo-cdc-bridge
CMD ["node", "src/index.mjs"]
