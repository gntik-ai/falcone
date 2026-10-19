import { createHash } from 'node:crypto';
import { validateLargeTaskWorkerProfile } from '../../../packages/internal-contracts/src/large-task-worker-profile.mjs';
import { runtimeTenantOwnership, validateRuntimeNamespace } from './runtime/mcp-runtime-namespace.mjs';

const violation = (code, message, field) => ({ code, severity: 'error', message, field });

function taskContext({ tenantId, workspaceId, generation, taskId, namespace, profile, config }) {
  const { violations } = validateLargeTaskWorkerProfile(profile, config);
  let resolvedNamespace;
  try {
    resolvedNamespace = validateRuntimeNamespace(namespace);
  } catch {
    violations.push(violation('invalid_namespace', 'Namespace must be a Kubernetes DNS label.', 'namespace'));
  }
  if (typeof tenantId !== 'string' || !tenantId) {
    violations.push(violation('invalid_tenant', 'tenantId is required.', 'tenantId'));
  }
  if (typeof taskId !== 'string' || !taskId) {
    violations.push(violation('invalid_task', 'taskId is required.', 'taskId'));
  }
  if (violations.length) return { violations };
  // Hash the complete identifier for names: case folding or truncation would alias tasks.
  const fingerprint = createHash('sha256').update(taskId).digest('hex').slice(0, 32);
  const taskLabel = /^[A-Za-z0-9](?:[-_.A-Za-z0-9]{0,61}[A-Za-z0-9])?$/.test(taskId)
    ? taskId : `t-${fingerprint}`;
  return {
    violations,
    namespace: resolvedNamespace,
    name: `large-task-${fingerprint}`,
    labels: {
      'in-falcone.io/component': 'large-task-worker',
      'in-falcone.io/tenant': runtimeTenantOwnership(tenantId),
      'in-falcone.io/task': taskLabel,
      ...(workspaceId === undefined ? {} : { 'in-falcone.io/workspace': runtimeTenantOwnership(workspaceId) }),
      ...(generation === undefined ? {} : { 'in-falcone.io/generation': String(generation) }),
    },
  };
}

/** Render only; the applying runtime and task-input file are deliberately separate. */
export function buildLargeTaskJob(input = {}) {
  const context = taskContext(input);
  if (context.violations.length) return { manifest: null, violations: context.violations };
  const { profile } = input;
  const resources = { cpu: profile.resources.cpu, memory: profile.resources.memory, 'ephemeral-storage': profile.resources.ephemeralStorage };
  return {
    manifest: {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: context.name, namespace: context.namespace, labels: { ...context.labels },
        ...(input.paramsSha256 === undefined ? {} : { annotations: { 'in-falcone.io/params-sha256': input.paramsSha256 } }),
        ...ownerReference(input.ownerJob),
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: profile.maxDurationSeconds,
        ttlSecondsAfterFinished: input.ttlSecondsAfterFinished ?? 600,
        ...(input.suspend === undefined ? {} : { suspend: input.suspend }),
        template: {
          metadata: { labels: { ...context.labels } },
          spec: {
            restartPolicy: 'Never',
            ...(input.terminationGracePeriodSeconds === undefined ? {} : { terminationGracePeriodSeconds: input.terminationGracePeriodSeconds }),
            ...(input.nodeNames === undefined ? {} : { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: input.nodeNames.map(name => ({ matchFields: [{ key: 'metadata.name', operator: 'In', values: [name] }] })),
            } } } }),
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            ...(profile.runtimeClassName === undefined ? {} : { runtimeClassName: profile.runtimeClassName }),
            containers: [{
              name: 'worker',
              ...(input.terminationMessagePolicy === undefined ? {} : { terminationMessagePolicy: input.terminationMessagePolicy }),
              image: profile.image,
              ...(profile.args === undefined ? {} : { args: [...profile.args] }),
              env: profile.env.map(({ name, value }) => ({ name, value })),
              securityContext: {
                runAsNonRoot: true,
                ...(profile.runAsUser === undefined ? {} : { runAsUser: profile.runAsUser }),
                ...(profile.runAsGroup === undefined ? {} : { runAsGroup: profile.runAsGroup }),
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
                readOnlyRootFilesystem: true,
              },
              resources: { requests: { ...resources }, limits: { ...resources } },
              volumeMounts: [{ name: 'workspace', mountPath: '/work' },
                ...(input.paramsConfigMap === undefined ? [] : [{ name: 'params', mountPath: '/task', readOnly: true }])],
            }],
            volumes: [{ name: 'workspace', emptyDir: { sizeLimit: profile.resources.ephemeralStorage } },
              ...(input.paramsConfigMap === undefined ? [] : [{ name: 'params', configMap: { name: input.paramsConfigMap } }])],
          },
        },
      },
    },
    violations: [],
  };
}

export function buildLargeTaskNetworkPolicy(input = {}) {
  const context = taskContext(input);
  if (context.violations.length) return { manifest: null, violations: context.violations };
  const { dnsNamespaces, allowedNamespaces } = input.profile.egress;
  const destinations = (namespaces) => namespaces.map((name) => ({
    namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': name } },
  }));
  const egress = [];
  if (dnsNamespaces.length) egress.push({
    to: destinations(dnsNamespaces),
    ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }],
  });
  if (allowedNamespaces.length) egress.push({ to: destinations(allowedNamespaces) });
  return {
    manifest: {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: context.name, namespace: context.namespace, labels: { ...context.labels },
        ...(input.paramsSha256 === undefined ? {} : { annotations: { 'in-falcone.io/params-sha256': input.paramsSha256 } }),
        ...ownerReference(input.ownerJob),
      },
      spec: {
        podSelector: { matchLabels: { ...context.labels } },
        policyTypes: ['Ingress', 'Egress'],
        ingress: [],
        egress,
      },
    },
    violations: [],
  };
}

/** Classify observed Kubernetes state; missing objects alone never prove cancellation. */
export function classifyLargeTaskTermination({ job, pods = [], cancelRequested = false } = {}) {
  const conditions = job?.status?.conditions ?? [];
  const observedPods = Array.isArray(pods) ? pods.filter(Boolean) : [];
  if (job?.status?.succeeded > 0
      || conditions.some((condition) => condition.type === 'Complete' && condition.status === 'True')
      || observedPods.some((pod) => pod.status?.phase === 'Succeeded')) return 'LARGE_TASK_SUCCEEDED';
  if (conditions.some((condition) => condition.type === 'Failed' && condition.status === 'True'
      && condition.reason === 'DeadlineExceeded')) return 'LARGE_TASK_DEADLINE_EXCEEDED';
  for (const pod of observedPods) {
    if (pod.status?.reason !== 'Evicted') continue;
    const message = pod.status.message ?? '';
    if (/The node was low on resource:/.test(message)) return 'LARGE_TASK_NODE_PRESSURE';
    if (/Usage of EmptyDir volume "[^"]+" exceeds the limit/.test(message)
        || /Container .+ exceeded its local ephemeral storage limit/.test(message)
        || /Pod ephemeral local storage usage exceeds the total limit of containers/.test(message)) {
      return 'LARGE_TASK_DISK_EXCEEDED';
    }
  }
  if (observedPods.some((pod) => [
    ...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? []),
  ].some((container) => container.state?.terminated?.reason === 'OOMKilled'))) return 'LARGE_TASK_MEMORY_EXCEEDED';
  if (cancelRequested === true) return 'LARGE_TASK_CANCELLED';
  if (!job || observedPods.length === 0) return 'LARGE_TASK_LOST';
  return 'LARGE_TASK_FAILED';
}

/** Explicit projection keeps environment values and image credentials out of audit data. */
export function largeTaskAuditRecord({ tenantId, workspaceId, taskId, code, profileVersion }) {
  return { tenantId, workspaceId, taskId, code, profileVersion };
}

function ownerReference(ownerJob) {
  return ownerJob ? { ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: ownerJob.name, uid: ownerJob.uid, blockOwnerDeletion: false }] } : {};
}

export function buildLargeTaskParamsConfigMap(input = {}) {
  const context = taskContext(input);
  let serialized;
  try { serialized = JSON.stringify({ parameters: input.parameters ?? null }); } catch { /* invalid input */ }
  if (serialized === undefined || Buffer.byteLength(serialized) > 65536) {
    context.violations.push(violation('params_too_large', 'Parameters must serialize to at most 65536 bytes including the envelope.', 'parameters'));
  }
  if (context.violations.length) return { manifest: null, violations: context.violations };
  return { manifest: {
    apiVersion: 'v1', kind: 'ConfigMap',
    metadata: { name: context.name, namespace: context.namespace, labels: { ...context.labels }, ...ownerReference(input.ownerJob) },
    data: { 'params.json': serialized },
  }, violations: [] };
}

/** Observe only this Job's pods. Absence after starting cannot prove safe re-execution. */
export function classifyLargeTaskState({ job, pods = [], events = [], observedPod, cancelRequested = false } = {}) {
  const owned = job?.metadata?.uid ? pods.filter(p => p.metadata?.labels?.['batch.kubernetes.io/controller-uid'] === job.metadata.uid) : [];
  const terminal = classifyLargeTaskTermination({ job, pods: owned, cancelRequested });
  if (!['LARGE_TASK_FAILED', 'LARGE_TASK_LOST'].includes(terminal)) return terminal;
  if (!job) return 'LARGE_TASK_OUTCOME_UNKNOWN';
  if (events.some(e => e.involvedObject?.uid === job.metadata.uid && e.reason === 'FailedCreate' && /exceeded quota/i.test(e.message ?? ''))) return 'LARGE_TASK_CAPACITY';
  const hasTerminal = owned.some(p => ['Failed', 'Succeeded'].includes(p.status?.phase))
    || job.status?.conditions?.some(c => ['Failed', 'Complete'].includes(c.type) && c.status === 'True');
  if (hasTerminal) return terminal;
  if (observedPod && !owned.some(p => p.metadata?.uid === observedPod || p.metadata?.name === observedPod)) return 'LARGE_TASK_LOST';
  if (owned.some(p => p.status?.phase === 'Running')) return 'RUNNING';
  if (!owned.length || owned.every(p => p.status?.phase === 'Pending')) return 'PENDING';
  return terminal;
}
