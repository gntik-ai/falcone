# Action-runner shim image (TEST ONLY).
#
# The shim's own code + node_modules (just `pg`) live at /app. The product repo
# is bind-mounted read-only at /repo by docker-compose, so the action modules
# under /repo/services/... are imported as-is at runtime. The scheduling action's
# entire import graph is node builtins + local .mjs only (no external npm deps),
# so /app/node_modules/pg is the only dependency the shim needs to resolve.
FROM node:22-alpine

WORKDIR /app

# Install the shim's deps only (pg). npm install (not ci) since there is no
# lockfile committed for this throwaway test shim.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Shim source.
COPY server.mjs routes.mjs ./

ENV PORT=8090
EXPOSE 8090

# NODE_PATH lets `import('pg')` from a module physically located under /repo
# resolve back to the shim's installed copy if Node's normal resolution ever
# walks up from /repo (belt-and-suspenders; the shim itself imports pg directly).
ENV NODE_PATH=/app/node_modules

HEALTHCHECK --interval=5s --timeout=4s --retries=20 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8090)+'/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
