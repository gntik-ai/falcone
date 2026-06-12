// Canonical first-party task-type names (change: add-flows-activity-catalog / #360).
//
// PURE DATA — NO Temporal / executor imports. This is the module the control-plane flows
// validate endpoint imports to feed FLW-E006 (`taskTypeCatalog`), so the control-plane
// process never has to resolve `@temporalio/activity` (which lives only in the
// workflow-worker's node_modules). The activity registry (./registry.mjs, ./catalog.mjs)
// registers EXACTLY these names; ./catalog.test verifies the two lists agree.

export const TASK_TYPE_NAMES = Object.freeze([
  'db.query',
  'storage.put',
  'storage.get',
  'functions.invoke',
  'events.publish',
  'http.request',
  'email.send',
]);
