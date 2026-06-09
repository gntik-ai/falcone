# Action-runner shim image (TEST ONLY).
#
# The shim's own code + node_modules live at /app. The product repo is
# bind-mounted read-only at /repo by docker-compose, so the action modules under
# /repo/services/... are imported as-is at runtime. The shim itself needs `pg`.
#
# Some PRODUCT actions imported from /repo have EXTERNAL npm deps. The scheduling
# / provisioning-orchestrator actions' import graphs are node builtins + local
# .mjs + `pg` only. But backup-status (the in-action JWKS-auth family) imports
# `jose` + `jwks-rsa`. Crucially, the repo is bind-mounted from a git WORKTREE
# that has NO node_modules, so the deps cannot be resolved under /repo. Node's
# ESM bare-specifier resolver does NOT honor NODE_PATH for static imports — it
# only walks `node_modules` up the directory tree from the importing file, whose
# LAST step (after /repo, which is read-only) is the filesystem root /node_modules.
# So we install these deps and expose them at /node_modules, where the
# /repo-imported action's resolver finds them.
FROM node:22-alpine

WORKDIR /app

# Install the shim + product-action deps (pg, plus jose/jwks-rsa for the
# backup-status action imported from /repo). npm install (not ci) since there is
# no lockfile committed for this throwaway test shim.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Expose the installed deps at the filesystem ROOT (/node_modules) so the ESM
# resolver, walking up from /repo/services/backup-status/src/api/, resolves
# `jose` / `jwks-rsa` (its final candidate is /node_modules). A symlink suffices.
RUN ln -sfn /app/node_modules /node_modules

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
