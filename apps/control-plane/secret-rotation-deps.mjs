import { vaultKvClientFromEnv } from './vault-secrets.mjs';
import { producer } from './kafka-handlers.mjs';
import { createKubernetesApi } from './kubernetes-api.mjs';
import { rotationSideEffect } from '../../packages/provisioning-orchestrator/src/actions/secret-rotation-side-effects.mjs';

let kubernetesApi;
const getApi = () => kubernetesApi ??= createKubernetesApi().catch(error => { kubernetesApi = undefined; throw error; });

// Keep the rotation envelope separate from the workspace store's flat data API.
export function createSecretRotationDependencies({ env = process.env, fetchImpl, getProducer = producer, getKubernetesApi = getApi, logger = console } = {}) {
  // Validation must not start Kubernetes auth or read service-account material.
  // Snapshot configuration now, then create and reuse the KV client on first I/O.
  const backendEnv = { ...env };
  const configured = Boolean((env.BAO_ADDR ?? env.VAULT_ADDR)
    && ((env.BAO_TOKEN ?? env.VAULT_TOKEN) || (env.BAO_KUBERNETES_AUTH_ROLE ?? env.VAULT_KUBERNETES_AUTH_ROLE)));
  let kv;
  const getKv = () => kv ??= vaultKvClientFromEnv(backendEnv, fetchImpl);
  return {
    publishEvent(topic, payload) {
      rotationSideEffect(async () => {
        const client = await getProducer();
        await client.send({ topic, messages: [{ key: payload.secretPath ?? null, value: JSON.stringify(payload) }] });
      }, { op: 'publishEvent', topic }, logger);
    },
    triggerEsoRefresh(name, namespace) {
      if (name == null) return;
      rotationSideEffect(async () => {
        const api = await getKubernetesApi();
        await api.patchExternalSecret(name, namespace, { metadata: { annotations: { 'force-sync': new Date().toISOString() } } });
      }, { op: 'triggerEsoRefresh', externalSecret: name, namespace }, logger);
    },
    vaultClient: configured ? {
      writeSecret: (path, body) => getKv().writeSecret(path, body.data),
      deleteSecretVersion: (path, version) => getKv().deleteSecretVersion(path, version),
    } : null,
  };
}

let shared;
export function getSecretRotationDependencies() {
  return shared ??= createSecretRotationDependencies();
}

// Listener-free boundary injection; never accepts dependencies from HTTP params.
export function __setSecretRotationTestHooks(options) {
  shared = options ? createSecretRotationDependencies(options) : undefined;
}
