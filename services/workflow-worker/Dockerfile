# Temporal DSL interpreter worker (change: add-flows-dsl-interpreter-worker / #359).
#
# Built from the REPO ROOT so workspace deps resolve, consistent with
# apps/control-plane/Dockerfile:
#   docker build -f services/workflow-worker/Dockerfile -t in-falcone-workflow-worker:0.1.0 .
#
# Two stages: (1) compile TypeScript → dist/ (CommonJS) with dev deps, then (2) a slim
# runtime image with only production deps and the compiled dist/, running as USER node.
FROM node:22-alpine AS build
WORKDIR /app/services/workflow-worker

# Install ALL deps (incl. typescript) for the tsc compile.
COPY services/workflow-worker/package.json ./package.json
RUN npm install --no-package-lock

# Compile.
COPY services/workflow-worker/tsconfig.json ./tsconfig.json
COPY services/workflow-worker/src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app/services/workflow-worker

# Production deps only.
COPY services/workflow-worker/package.json ./package.json
RUN npm install --omit=dev --no-package-lock

# Compiled output.
COPY --from=build /app/services/workflow-worker/dist ./dist

ENV NODE_ENV=production \
    TEMPORAL_ADDRESS=temporal-frontend:7233 \
    TEMPORAL_NAMESPACE=falcone-flows \
    TEMPORAL_TASK_QUEUE=flows-main \
    WORKER_HEALTH_PORT=8080

EXPOSE 8080
USER node
CMD ["node", "dist/worker.js"]
