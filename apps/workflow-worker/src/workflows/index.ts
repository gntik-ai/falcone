/**
 * Workflow bundle entry point. The Temporal worker bundles THIS module (and its
 * transitive imports) into the deterministic V8 isolate. Only deterministic code may be
 * reachable from here.
 */
export {
  DslInterpreterWorkflow,
  approvalSignal,
  traceQuery,
  type ApprovalSignalPayload,
} from './DslInterpreterWorkflow';
