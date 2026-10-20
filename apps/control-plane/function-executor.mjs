// Function executor (kind deploy) — KNATIVE-backed.
//
// A function = a Knative Service (ksvc) running the fn-runtime image with the
// source injected via FN_SRC. Deploy creates/updates the ksvc (new revision on
// code change; cluster-local, scale-to-zero). Invoke is an HTTP POST to the ksvc's
// cluster-internal URL (Knative scales it from zero, runs main(params), returns
// { status, result, logs }). Talks to the k8s API with the in-cluster SA token+CA
// via node:https (no SDK); the control-plane SA is granted ksvc + jobs RBAC.
//
// Replaces the earlier Job-per-invoke executor (and the OpenWhisk attempt, whose
// Python2/ansible init images are incompatible with this host kernel).
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { invocationPublicJwks, mintInvocationCredential } from './function-invocation-auth.mjs';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
export const NS = (() => { try { return fs.readFileSync(`${SA}/namespace`, 'utf8').trim(); } catch { return 'falcone'; } })();
const CA = (() => { try { return fs.readFileSync(`${SA}/ca.crt`); } catch { return undefined; } })();
const readToken = () => { try { return fs.readFileSync(`${SA}/token`, 'utf8').trim(); } catch { return ''; } };
const HOST = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
const PORT = process.env.KUBERNETES_SERVICE_PORT || '443';
// The runtime image each function ksvc runs (Harbor path in prod; in-cluster registry on kind).
export const FN_RUNTIME_IMAGE = process.env.FN_RUNTIME_IMAGE || 'localhost:30500/in-falcone-fn-runtime:0.1.0';
export const FUNCTION_OWNERSHIP_LABELS = Object.freeze({
  tenant: 'in-falcone.io/tenant',
  functionResource: 'in-falcone.io/function-resource',
});

const KUBERNETES_LABEL_VALUE = /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])$/;
const KUBERNETES_SERVICE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
const RESERVED_FUNCTION_ENV_NAMES = new Set([
  'FN_SRC', 'FN_KSVC_NAME', 'FN_TENANT_ID', 'FN_WORKSPACE_ID',
  'FN_INVOCATION_JWKS', 'FN_INVOCATION_PRIVATE_KEY', 'FN_INVOCATION_KEY_ID',
  'FN_INVOCATION_SECRET_DIR',
  'K_SERVICE', 'NODE_OPTIONS', 'NODE_PATH',
]);
export const isReservedFunctionEnvName = (name) => RESERVED_FUNCTION_ENV_NAMES.has(name);

function k8s(method, path, body, { contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request({
      host: HOST, port: PORT, path, method, ca: CA,
      headers: {
        authorization: `Bearer ${readToken()}`, accept: 'application/json',
        ...(data ? { 'content-type': contentType, 'content-length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) { const e = new Error(`k8s ${method} ${path} -> ${res.statusCode}: ${buf.slice(0, 300)}`); e.statusCode = res.statusCode; return reject(e); }
        try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// DNS-1035 service name (lowercase alnum + '-', start with a letter, <=63).
export function ksvcName(workspaceSlug, actionName) {
  let v = `fn-${workspaceSlug || 'ws'}-${actionName || 'a'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(v)) v = `fn-${v}`;
  return v.slice(0, 63).replace(/-+$/, '');
}

// Knative Service name for a function, GLOBALLY UNIQUE per (tenant, workspace).
// Two tenants frequently share a workspace slug (e.g. both "app-staging");
// deriving the ksvc name from the slug + action alone collided their same-named
// actions on ONE shared ksvc, so one tenant's deploy clobbered — and its invoke
// could run — the other tenant's code (P0 ISO-FUNCTIONS). We append a short,
// stable hash of `tenantId:workspaceId` (each globally unique) so same-named
// workspaces across tenants get distinct ksvcs, while keeping the slug for human
// readability. Deterministic, so a redeploy/invoke resolves the same caller-scoped
// ksvc. DNS-1035 still holds (<=63, lowercase alnum + '-', starts with a letter).
export function ksvcNameForWorkspace(workspace = {}, actionName) {
  const tenantId = workspace.tenant_id ?? workspace.tenantId ?? '';
  const workspaceId = workspace.id ?? workspace.workspaceId ?? '';
  const slug = workspace.slug ?? (workspaceId ? String(workspaceId).slice(0, 8) : '');
  const disc = createHash('sha256').update(`${tenantId}:${workspaceId}`).digest('hex').slice(0, 10);
  let base = `fn-${slug || 'ws'}-${actionName || 'a'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `fn-${base}`;
  // Reserve room for the "-<disc>" suffix within the 63-char DNS-1035 limit.
  base = base.slice(0, 63 - disc.length - 1).replace(/-+$/, '');
  return `${base}-${disc}`;
}
export const ksvcHost = (name) => `${name}.${NS}.svc.cluster.local`;

function ownershipLabelValue(value, fieldName) {
  const text = typeof value === 'string' ? value : '';
  if (!text) throw new TypeError(`${fieldName} is required for Function runtime ownership`);
  if (text.length <= 63 && KUBERNETES_LABEL_VALUE.test(text)) return text;
  // Preserve ordinary Falcone IDs for operability. IDs outside the Kubernetes label-value grammar
  // receive a deterministic collision-resistant representation that remains selector-safe.
  return `sha256-${createHash('sha256').update(text).digest('hex').slice(0, 56)}`;
}

export function buildFunctionOwnershipLabels({ tenantId, functionResourceId } = {}) {
  return {
    [FUNCTION_OWNERSHIP_LABELS.tenant]: ownershipLabelValue(tenantId, 'tenantId'),
    [FUNCTION_OWNERSHIP_LABELS.functionResource]: ownershipLabelValue(
      functionResourceId,
      'functionResourceId',
    ),
  };
}

function hasFunctionOwnershipLabels(resource, expectedLabels) {
  const actual = resource?.metadata?.labels ?? {};
  return Object.entries(expectedLabels).every(([key, value]) => actual[key] === value);
}

function ownershipRetentionError(reason) {
  return Object.assign(
    new Error('Knative Service ownership could not be verified; the resource was retained'),
    {
      code: 'FN_RUNTIME_OWNERSHIP_MISMATCH',
      statusCode: 409,
      retained: true,
      reason,
    },
  );
}

function servicePath(name) {
  const value = String(name ?? '');
  if (!KUBERNETES_SERVICE_NAME.test(value)) {
    throw new TypeError('name must be a Kubernetes-valid Function Service name');
  }
  return `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/services/${encodeURIComponent(value)}`;
}

export const functionSecretName = (name) => `${name}-secrets`;

export function buildFunctionKsvcManifest(
  name,
  source,
  { tenantId, workspaceId, functionResourceId, memoryMb = 256, timeoutMs = 60000, secretEnv = [], secretRefs, rotateSecrets = false } = {},
) {
  // OpenBao values belong only in the owned Secret, never in workload specifications.
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('workspaceId is required for Function invocation verification');
  // Workspace secrets cannot override verification configuration or import signing material.
  if (!Array.isArray(secretEnv) || [
    ...secretEnv,
    ...(secretRefs ?? []).map((ref) => ({ name: ref.env ?? ref.name })),
  ].some((entry) => isReservedFunctionEnvName(entry?.name))) {
    throw Object.assign(new TypeError('Workspace secret env uses a reserved Function runtime name'), { statusCode: 400 });
  }
  const secretEnvNames = (secretRefs ?? secretEnv).map(({ env, name: refName }) => env ?? refName);
  const env = [
    ...secretEnvNames.map((envName) => ({
      name: envName,
      valueFrom: { secretKeyRef: { name: functionSecretName(name), key: envName, optional: false } },
    })),
    { name: 'FN_SRC', value: source },
    { name: 'FN_KSVC_NAME', value: name },
    { name: 'FN_TENANT_ID', value: tenantId },
    { name: 'FN_WORKSPACE_ID', value: workspaceId },
    { name: 'FN_INVOCATION_JWKS', value: JSON.stringify(invocationPublicJwks()) },
  ];
  const ownershipLabels = buildFunctionOwnershipLabels({ tenantId, functionResourceId });
  return {
    apiVersion: 'serving.knative.dev/v1', kind: 'Service',
    metadata: {
      name,
      namespace: NS,
      labels: {
        'networking.knative.dev/visibility': 'cluster-local',
        'in-falcone.function': 'true',
        ...ownershipLabels,
      },
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            ...(rotateSecrets ? { 'in-falcone.io/secret-rollout': randomUUID() } : {}),
            'autoscaling.knative.dev/min-scale': '0',
            'autoscaling.knative.dev/max-scale': '5',
          },
          labels: { ...ownershipLabels, 'in-falcone.io/component': 'function' },
        },
        spec: {
          containerConcurrency: 10,
          timeoutSeconds: Math.min(Math.ceil(timeoutMs / 1000) + 5, 300),
          containers: [{
            image: FN_RUNTIME_IMAGE,
            env,
            resources: { limits: { cpu: '1', memory: `${memoryMb}Mi` }, requests: { cpu: '50m', memory: '64Mi' } },
            // OpenShift-friendly: runAsNonRoot, no fixed uid (image USER 1000 on kind; SCC assigns on OCP).
            securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } }
          }]
        }
      }
    }
  };
}

function secretPath(name) {
  servicePath(name); // Validate the Function name before constructing either resource path.
  return `/api/v1/namespaces/${encodeURIComponent(NS)}/secrets/${functionSecretName(name)}`;
}

function verifiedMetadata(resource, labels) {
  if (!hasFunctionOwnershipLabels(resource, labels)
      || !resource?.metadata?.resourceVersion || !resource?.metadata?.uid) {
    throw ownershipRetentionError('ownership_mismatch');
  }
  return resource.metadata;
}

function deleteOptions(metadata, propagationPolicy = 'Foreground') {
  return { apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy,
    preconditions: { uid: metadata.uid, resourceVersion: metadata.resourceVersion } };
}

export function buildFunctionSecretManifest(name, { tenantId, functionResourceId, secretEnv = [], serviceUid } = {}) {
  const labels = buildFunctionOwnershipLabels({ tenantId, functionResourceId });
  return {
    apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
    metadata: { name: functionSecretName(name), namespace: NS, labels,
      ...(serviceUid ? { ownerReferences: [{ apiVersion: 'serving.knative.dev/v1', kind: 'Service',
        name, uid: serviceUid, controller: true }] } : {}) },
    data: Object.fromEntries(secretEnv.map(({ name: key, value }) => [key, Buffer.from(String(value)).toString('base64')])),
  };
}

async function deleteOwnedSecret(name, labels, request, verifyAbsence = false) {
  const path = secretPath(name);
  let existing;
  try { existing = await request('GET', path); }
  catch (error) { if (error.statusCode === 404) return; throw error; }
  const metadata = verifiedMetadata(existing, labels);
  // A projection is a leaf: background deletion avoids a foreground GC finalizer while
  // still verifying absence before revocation succeeds. Custom finalizers remain fail-closed.
  try { await request('DELETE', path, deleteOptions(metadata, 'Background')); }
  catch (error) { if (error.statusCode !== 404) throw error; }
  if (verifyAbsence) {
    try { await request('GET', path); }
    catch (error) { if (error.statusCode === 404) return; throw error; }
    throw ownershipRetentionError('deletion_not_observed');
  }
}

// Secret API errors may echo the request body (including base64 values). Never surface them.
function projectionError(error) {
  return Object.assign(new Error('Function secret projection could not be completed'), {
    statusCode: error?.statusCode ?? 502, code: error?.code ?? 'FN_SECRET_PROJECTION_FAILED',
    reason: error?.reason,
  });
}

// OpenBao remains the source of truth; this Secret is a replaceable, owned projection.
export async function deployKnativeService(name, source, opts = {}) {
  const { request = k8s, ...manifestOptions } = opts;
  const manifest = buildFunctionKsvcManifest(name, source, manifestOptions);
  const labels = buildFunctionOwnershipLabels(manifestOptions);
  const namedServicePath = servicePath(name);
  const namedSecretPath = secretPath(name);
  const hasSecrets = manifestOptions.secretEnv?.length > 0;
  let createdSecret = false;
  let createdService = false;
  let projected;
  let previousSecret;
  const bindProjection = async (service) => {
    if (!hasSecrets) return;
    const metadata = verifiedMetadata(projected, labels);
    const serviceMetadata = verifiedMetadata(service, labels);
    const ownerReferences = buildFunctionSecretManifest(name, { ...manifestOptions, serviceUid: serviceMetadata.uid }).metadata.ownerReferences;
    if (metadata.ownerReferences?.length === 1
        && metadata.ownerReferences[0].blockOwnerDeletion !== true
        && Object.entries(ownerReferences[0]).every(([key, value]) => metadata.ownerReferences[0][key] === value)) {
      return;
    }
    projected = await request('PATCH', namedSecretPath, {
      metadata: { resourceVersion: metadata.resourceVersion, ownerReferences },
    }, { contentType: 'application/merge-patch+json' });
  };
  try {
    if (hasSecrets) {
      const secret = buildFunctionSecretManifest(name, manifestOptions);
      try {
        projected = await request('POST', namedSecretPath.slice(0, namedSecretPath.lastIndexOf('/')), secret);
        createdSecret = true;
      } catch (error) {
        if (error.statusCode !== 409) throw error;
        const existing = await request('GET', namedSecretPath);
        const metadata = verifiedMetadata(existing, labels);
        previousSecret = existing;
        // Full replacement prunes dropped keys; never merge data maps.
        secret.metadata.resourceVersion = metadata.resourceVersion;
        secret.metadata.ownerReferences = metadata.ownerReferences;
        projected = await request('PUT', namedSecretPath, secret);
      }
    } else {
      await deleteOwnedSecret(name, labels, request, true);
    }
    let service;
    try {
      service = await request('POST', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/services`, manifest);
      createdService = true;
    } catch (error) {
      if (error.statusCode !== 409) throw error;
      const existing = await request('GET', namedServicePath);
      if (!hasFunctionOwnershipLabels(existing, labels) || typeof existing?.metadata?.resourceVersion !== 'string') {
        throw ownershipRetentionError('ownership_mismatch');
      }
      // An existing Service UID is known: bind the projection before any Service mutation.
      await bindProjection(existing);
      service = await request('PATCH', namedServicePath, {
        metadata: { resourceVersion: existing.metadata.resourceVersion, labels: manifest.metadata.labels },
        spec: manifest.spec,
      }, { contentType: 'application/merge-patch+json' });
    }
    if (createdService && hasSecrets) {
      if (!service?.metadata?.uid) service = await request('GET', namedServicePath);
      await bindProjection(service);
    }
  } catch (error) {
    try {
      if (createdService) await deleteKnativeService(name, { ...manifestOptions, request, verifyAbsence: true });
      else if (createdSecret) await deleteOwnedSecret(name, labels, request, true);
      else if (previousSecret && projected) {
        // A rejected Service update must not leave untracked new keys in an existing projection.
        const live = await request('GET', namedSecretPath);
        const metadata = verifiedMetadata(live, labels);
        if (metadata.uid !== previousSecret.metadata.uid || metadata.resourceVersion !== projected.metadata?.resourceVersion) {
          throw ownershipRetentionError('precondition_conflict');
        }
        await request('PUT', namedSecretPath, { ...previousSecret,
          metadata: { ...previousSecret.metadata, resourceVersion: metadata.resourceVersion } });
      }
    } catch { throw projectionError({ statusCode: 502, code: 'FN_SECRET_CLEANUP_PENDING' }); }
    throw projectionError(error);
  }
  return ksvcHost(name);
}

export async function deleteKnativeService(
  name,
  { tenantId, functionResourceId, request = k8s, verifyAbsence = false } = {},
) {
  const expectedLabels = buildFunctionOwnershipLabels({ tenantId, functionResourceId });
  const namedServicePath = servicePath(name);
  let existing;
  try {
    existing = await request('GET', namedServicePath);
  } catch (error) {
    if (error.statusCode === 404) {
      await deleteOwnedSecret(name, expectedLabels, request, verifyAbsence);
      return { deleted: false, retained: false, reason: 'not_found' };
    }
    throw error;
  }

  if (!hasFunctionOwnershipLabels(existing, expectedLabels)) {
    throw ownershipRetentionError('ownership_mismatch');
  }

  const uid = existing?.metadata?.uid;
  const resourceVersion = existing?.metadata?.resourceVersion;
  if (typeof uid !== 'string' || !uid || typeof resourceVersion !== 'string' || !resourceVersion) {
    throw ownershipRetentionError('verification_incomplete');
  }

  await deleteOwnedSecret(name, expectedLabels, request, verifyAbsence);

  // The named delete is not authorized by namespace+name alone: Kubernetes must match both the UID
  // and resourceVersion of the object whose tenant+Function labels were just verified. Replacement
  // or label mutation between GET and DELETE therefore fails closed instead of deleting by name.
  let deleted = true;
  try {
    await request('DELETE', namedServicePath, {
      apiVersion: 'v1',
      kind: 'DeleteOptions',
      propagationPolicy: 'Foreground',
      preconditions: { uid, resourceVersion },
    });
  } catch (error) {
    if (error.statusCode === 404) {
      deleted = false;
    } else {
      throw error;
    }
  }
  if (verifyAbsence) {
    // Kubernetes may accept DELETE before the Service disappears. A deferred cleanup cannot
    // complete its logical record until a fresh read proves the named resource is absent.
    try {
      await request('GET', namedServicePath);
    } catch (error) {
      if (error.statusCode === 404) {
        return { deleted, retained: false, reason: deleted ? 'deleted' : 'not_found' };
      }
      throw error;
    }
    throw ownershipRetentionError('deletion_not_observed');
  }
  return { deleted, retained: false, reason: deleted ? 'deleted' : 'not_found' };
}

const descendantCollections = () => [
  ['Configuration', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/configurations`],
  ['Revision', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/revisions`],
  ['Deployment', `/apis/apps/v1/namespaces/${encodeURIComponent(NS)}/deployments`],
  ['ReplicaSet', `/apis/apps/v1/namespaces/${encodeURIComponent(NS)}/replicasets`],
];

const KNATIVE_USER_CONTAINER_ENV = new Set(['PORT', 'K_REVISION', 'K_CONFIGURATION']);

function inlineEnvNames(resource, kind, userEnvNames = new Set()) {
  const spec = resource?.spec?.template?.spec ?? resource?.spec;
  const reconciled = kind === 'Deployment' || kind === 'ReplicaSet';
  return [...new Set((spec?.containers ?? [])
    .filter((container) => !reconciled || container.name !== 'queue-proxy')
    .flatMap((container) => (container.env ?? [])
    .filter((env) => Object.hasOwn(env, 'value') && !isReservedFunctionEnvName(env.name))
    // Knative adds these literals only in reconciled pod templates. A name also present in
    // an inline user template must still be checked for legacy secret material.
    .filter((env) => !reconciled || !KNATIVE_USER_CONTAINER_ENV.has(env.name) || userEnvNames.has(env.name))
    .map((env) => env.name)))];
}

// Selectors narrow reads; UID ancestry, rather than a selector alone, authorizes deletion.
async function legacyFunctionObjects(name, opts) {
  const { request = k8s } = opts;
  const labels = buildFunctionOwnershipLabels(opts);
  const service = await request('GET', servicePath(name));
  const root = verifiedMetadata(service, labels);
  const candidates = [];
  for (const [kind, collection] of descendantCollections()) {
    let next = '';
    do {
      const params = new URLSearchParams({ labelSelector: `serving.knative.dev/service=${name}`, limit: '200', ...(next ? { continue: next } : {}) });
      const result = await request('GET', `${collection}?${params}`);
      for (const resource of result.items ?? []) candidates.push({ kind, collection, resource });
      next = result.metadata?.continue ?? '';
    } while (next);
  }
  const owned = new Set([root.uid]);
  let changed;
  do {
    changed = false;
    for (const { resource } of candidates) {
      if (!owned.has(resource.metadata?.uid) && resource.metadata?.ownerReferences?.some((ref) => owned.has(ref.uid))) {
        owned.add(resource.metadata.uid); changed = true;
      }
    }
  } while (changed);
  const items = [{ kind: 'Service', collection: servicePath(name).slice(0, servicePath(name).lastIndexOf('/')), resource: service },
    ...candidates.filter(({ resource }) => owned.has(resource.metadata?.uid))];
  const userEnvNames = new Set();
  for (const { kind, resource } of items) {
    if (kind === 'Deployment' || kind === 'ReplicaSet') continue;
    for (const envName of inlineEnvNames(resource, kind)) userEnvNames.add(envName);
  }
  return items.map((item) => ({ ...item, envNames: inlineEnvNames(item.resource, item.kind, userEnvNames) }))
    .filter(({ envNames }) => envNames.length);
}

const legacyReport = (items) => items.map(({ kind, resource, envNames }) => ({ kind, name: resource.metadata.name, envNames }));

// Namespace inventory is read-only and uses the existing Service list permission.
// Secret values and user source never enter this operator report.
export async function discoverInlineFunctionSecrets({ request = k8s } = {}) {
  const functions = [];
  let next = '';
  do {
    const params = new URLSearchParams({
      labelSelector: Object.values(FUNCTION_OWNERSHIP_LABELS).join(','), limit: '200',
      ...(next ? { continue: next } : {}),
    });
    const result = await request('GET', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/services?${params}`);
    for (const service of result.items ?? []) {
      const labels = service.metadata?.labels ?? {};
      const tenantId = labels[FUNCTION_OWNERSHIP_LABELS.tenant];
      const resourceId = labels[FUNCTION_OWNERSHIP_LABELS.functionResource];
      if (!tenantId || !resourceId) continue;
      const name = service.metadata.name;
      const report = await remediateFunctionSecrets(name, undefined, {
        tenantId, functionResourceId: resourceId, request,
      });
      if (report.affected.length) functions.push({ tenantId, resourceId, name, affected: report.affected });
    }
    next = result.metadata?.continue ?? '';
  } while (next);
  return { dryRun: true, functions };
}

export async function pruneInlineFunctionRevisions(name, opts = {}) {
  const request = opts.request ?? k8s;
  const affected = await legacyFunctionObjects(name, opts);
  for (const { kind, resource, collection } of affected) {
    if (kind !== 'Revision') continue; // Revisions are immutable; foreground GC removes children.
    if (!resource.metadata?.uid || !resource.metadata?.resourceVersion) throw ownershipRetentionError('verification_incomplete');
    try { await request('DELETE', `${collection}/${encodeURIComponent(resource.metadata.name)}`, deleteOptions(resource.metadata)); }
    catch (error) { if (error.statusCode !== 404) throw projectionError(error); }
  }
  return { affected: legacyReport(affected), pending: legacyReport(await legacyFunctionObjects(name, opts)) };
}

// Operator-triggered only. Dry runs report identifiers and env names, never literal values.
export async function remediateFunctionSecrets(name, source, opts = {}) {
  const { dryRun = true } = opts;
  const affected = legacyReport(await legacyFunctionObjects(name, opts));
  if (dryRun) return { dryRun: true, affected, pending: affected };
  await deployKnativeService(name, source, { ...opts, rotateSecrets: true });
  const result = await pruneInlineFunctionRevisions(name, opts);
  return { dryRun: false, affected, pending: result.pending };
}

// Wait until the ksvc reports Ready (best-effort; invoke also tolerates cold start).
export async function waitKsvcReady(name, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const svc = await k8s('GET', `/apis/serving.knative.dev/v1/namespaces/${NS}/services/${name}`).catch(() => null);
    const ready = (svc?.status?.conditions ?? []).find((c) => c.type === 'Ready');
    if (ready?.status === 'True') return true;
    if (ready?.status === 'False' && ready?.reason && ready.reason !== 'Deploying' && ready.reason !== 'Unknown') return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// Sign the target and verified caller identity, independently of user-controlled params.
// Legacy identity headers remain for rollout compatibility; new runtimes use signed claims.
export function buildInvokeHeaders(payload, caller = null, target = {}) {
  const headers = {
    'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    authorization: `Bearer ${mintInvocationCredential(payload, caller, target)}`,
  };
  if (caller) {
    const set = (name, value) => { if (typeof value === 'string' && value.length) headers[name] = value; };
    set('x-falcone-tenant-id', caller.tenantId);
    set('x-falcone-workspace-id', caller.workspaceId);
    set('x-falcone-principal', caller.principal);
    set('x-falcone-actor-type', caller.actorType);
    const roles = Array.isArray(caller.roles) ? caller.roles.filter(Boolean) : [];
    if (roles.length) headers['x-falcone-roles'] = roles.join(',');
  }
  return headers;
}

// Invoke a function over its ksvc cluster-internal URL (Knative scales from zero).
// `caller` (verified identity) is signed with the target; headers support old runtime revisions.
export function invokeKnative(host, params, { timeoutMs = 60000, caller = null, audience, tenantId, workspaceId } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const payload = JSON.stringify(params ?? {});
    let headers;
    try {
      headers = buildInvokeHeaders(payload, caller, { audience, tenantId, workspaceId });
    } catch {
      return resolve({ status: 'failure', result: { error: 'Function invocation signing is not configured correctly' }, logs: [], durationMs: 0, statusCode: 503 });
    }
    const credential = headers.authorization.slice(7);
    const redact = (value) => String(value).split(credential).join('[REDACTED]');
    const req = http.request({
      host, port: 80, path: '/', method: 'POST',
      headers, timeout: timeoutMs
    }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const durationMs = Date.now() - started;
        let parsed; try { parsed = JSON.parse(redact(buf)); } catch { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && parsed) {
          resolve({ status: parsed.status === 'success' ? 'success' : 'failure', result: parsed.result ?? {}, logs: parsed.logs ?? [], durationMs, statusCode: parsed.status === 'success' ? 200 : 502 });
        } else {
          resolve({ status: 'failure', result: { error: `runtime HTTP ${res.statusCode}` }, logs: [], durationMs, statusCode: 502 });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'failure', result: { error: 'invocation timed out' }, logs: [], durationMs: Date.now() - started, statusCode: 504 }); });
    req.on('error', (e) => resolve({ status: 'failure', result: { error: redact(e.message ?? e) }, logs: [], durationMs: Date.now() - started, statusCode: 502 }));
    req.write(payload); req.end();
  });
}
