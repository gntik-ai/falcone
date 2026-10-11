import { collectRouteCatalogViolations, readRouteReconciliationInputs } from './lib/control-plane-routes.mjs';
const errors = await collectRouteCatalogViolations(await readRouteReconciliationInputs());
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else console.log('Control-plane route catalog, runtime handlers and invoke modes reconcile.');
