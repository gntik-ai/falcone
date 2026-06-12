/**
 * Node-ID activity naming convention (design.md D3) — the NORMATIVE CONTRACT for
 * monitoring (#366).
 *
 * Every `executeActivity` call made by DslInterpreterWorkflow passes its options with
 * `activityId` set to the DSL node id (optionally suffixed `#<loopCounter>` for an
 * iterated node). `activityId` is surfaced verbatim on the `ActivityTaskScheduled`
 * history event, so every history event maps back unambiguously to a canvas node with
 * no custom header parsing.
 *
 *   history event ActivityTaskScheduled.activityId === DSL node.id (or node.id#<n>)
 *
 * #366 monitoring and the node-ID history test in tests/env/workflow-worker rely on
 * this exact encoding. Changing it is a breaking change to the monitoring contract.
 */

/** Separator between the node id and an optional loop counter. */
export const NODE_ID_LOOP_SEPARATOR = '#';

/**
 * Build the Temporal activityId for a DSL node.
 * @param nodeId      the DSL node id (stable canvas identifier)
 * @param loopCounter optional iteration index for an iterated node
 */
export function activityIdForNode(nodeId: string, loopCounter?: number): string {
  if (loopCounter === undefined || loopCounter === null) {
    return nodeId;
  }
  return `${nodeId}${NODE_ID_LOOP_SEPARATOR}${loopCounter}`;
}

/** Recover the DSL node id from an activityId (drops any loop-counter suffix). */
export function nodeIdFromActivityId(activityId: string): string {
  const idx = activityId.indexOf(NODE_ID_LOOP_SEPARATOR);
  return idx === -1 ? activityId : activityId.slice(0, idx);
}
