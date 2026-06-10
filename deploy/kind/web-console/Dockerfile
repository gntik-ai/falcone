# TEST/DEPLOY-ONLY image: serves the real built web-console SPA (vite dist) on :3000.
# Node static server (no nginx): zero fs writes -> safe with readOnlyRootFilesystem,
# numeric non-root USER -> passes runAsNonRoot verification.
FROM node:22-alpine
WORKDIR /app
COPY static-server.mjs ./
COPY dist/ ./dist/
USER 1000
EXPOSE 3000
CMD ["node", "static-server.mjs"]
