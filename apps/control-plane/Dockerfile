# Control-plane executor service (change: add-control-plane-executor).
# Build from the REPO ROOT so the executor's relative import of the adapter plan
# builders (apps/control-plane/src/runtime -> ../../../../services/adapters/src) resolves:
#   docker build -f apps/control-plane/Dockerfile -t in-falcone-control-plane:0.7.0 .
FROM node:22-alpine

WORKDIR /app

# Install runtime deps (pg) into apps/control-plane/node_modules — Node resolves it
# walking up from src/runtime/.
COPY apps/control-plane/package.json /app/apps/control-plane/package.json
RUN cd /app/apps/control-plane && npm install --omit=dev --no-package-lock

# App sources + the adapter plan-builder layer the executor imports.
COPY apps/control-plane/src /app/apps/control-plane/src
COPY services/adapters/src /app/services/adapters/src

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080
USER node
WORKDIR /app/apps/control-plane
CMD ["node", "src/runtime/main.mjs"]
