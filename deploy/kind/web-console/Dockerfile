# TEST/DEPLOY-ONLY compatibility image. The release image source of truth is
# apps/web-console/Dockerfile; this file is retained for local deploy/test
# scripts that still point at deploy/kind/web-console.
# Node static server (no nginx): zero fs writes -> safe with readOnlyRootFilesystem,
# numeric non-root USER -> passes runAsNonRoot verification.
FROM node:22-alpine
WORKDIR /app
COPY apps/web-console/static-server.mjs ./
COPY apps/web-console/dist/ ./dist/
USER 1000
EXPOSE 3000
CMD ["node", "static-server.mjs"]
