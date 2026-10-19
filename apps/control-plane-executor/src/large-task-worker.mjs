import { createHash } from 'node:crypto';
import { validateLargeTaskWorkerProfile } from '../../../packages/internal-contracts/src/large-task-worker-profile.mjs';
import { runtimeTenantOwnership, validateRuntimeNamespace } from './runtime/mcp-runtime-namespace.mjs';

const violation = (code, message, field) => ({ code, severity: 'error', message, field });

function taskContext({ tenantId, taskId, namespace, profile, config }) {
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
      metadata: { name: context.name, namespace: context.namespace, labels: { ...context.labels } },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: profile.maxDurationSeconds,
        ttlSecondsAfterFinished: 600,
        template: {
          metadata: { labels: { ...context.labels } },
          spec: {
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            ...(profile.runtimeClassName === undefined ? {} : { runtimeClassName: profile.runtimeClassName }),
            containers: [{
              name: 'worker',
              image: profile.image,
              env: profile.env.map(({ name, value }) => ({ name, value })),
              securityContext: {
                runAsNonRoot: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
                readOnlyRootFilesystem: true,
              },
              resources: { requests: { ...resources }, limits: { ...resources } },
              volumeMounts: [{ name: 'workspace', mountPath: '/work' }],
            }],
            volumes: [{ name: 'workspace', emptyDir: { sizeLimit: profile.resources.ephemeralStorage } }],
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
      metadata: { name: context.name, namespace: context.namespace, labels: { ...context.labels } },
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
