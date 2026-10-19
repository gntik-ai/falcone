export const LARGE_TASK_WORKER_PROFILE_VERSION = 1;

export const LARGE_TASK_WORKER_PROFILE_TEMPLATE = Object.freeze({
  env: Object.freeze([]),
  resources: Object.freeze({ cpu: 2, memory: '4Gi', ephemeralStorage: '20Gi' }),
  maxDurationSeconds: 7200,
  codeExecution: 'disabled',
  egress: Object.freeze({ dnsNamespaces: Object.freeze([]), allowedNamespaces: Object.freeze([]) }),
});

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const QUANTITY = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[EPTGMK]i|[EPTGMkmun]|[eE][+-]?\d+)?$/;

/** Closed operator configuration; never accepts task parameters or reads ambient state. */
export function validateLargeTaskWorkerProfile(profile, config) {
  const violations = [];
  const fail = (field, message, code = 'invalid_value') => {
    violations.push({ code, severity: 'error', message, field });
  };
  const object = (value, keys, field) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(field, 'Expected an object.');
      return false;
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(field ? `${field}.${key}` : key, 'Unknown field.', 'unknown_field');
    }
    return true;
  };
  const strings = (value, field, pattern) => {
    if (!Array.isArray(value)) {
      fail(field, 'Expected an array.');
      return false;
    }
    value.forEach((entry, index) => {
      if (typeof entry !== 'string' || !pattern.test(entry)) fail(`${field}[${index}]`, 'Invalid list entry.');
    });
    return true;
  };
  let approvedImages = [];
  let approvedClasses = [];
  if (object(config, ['approvedImages', 'approvedSandboxRuntimeClasses'], 'config')) {
    if (!Array.isArray(config.approvedImages)) {
      fail('config.approvedImages', 'Expected approved image entries.');
    } else {
      approvedImages = config.approvedImages;
      approvedImages.forEach((entry, index) => {
        const field = `config.approvedImages[${index}]`;
        if (!object(entry, ['ref', 'allowedEnv'], field)) return;
        if (typeof entry.ref !== 'string' || !DIGEST_IMAGE.test(entry.ref)) {
          fail(`${field}.ref`, 'Approved images require a full sha256 digest.', 'image_not_digest_pinned');
        }
        strings(entry.allowedEnv, `${field}.allowedEnv`, ENV_NAME);
      });
    }
    if (config.approvedSandboxRuntimeClasses !== undefined) {
      if (strings(config.approvedSandboxRuntimeClasses, 'config.approvedSandboxRuntimeClasses', DNS_LABEL)) {
        approvedClasses = config.approvedSandboxRuntimeClasses;
      }
    }
  }
  if (object(profile, ['image', 'env', 'resources', 'maxDurationSeconds', 'codeExecution', 'runtimeClassName', 'egress'], '')) {
    const approval = approvedImages.find((entry) => entry && entry.ref === profile.image);
    if (typeof profile.image !== 'string' || !DIGEST_IMAGE.test(profile.image) || !approval) {
      fail('image', 'Image must exactly match an approved digest-pinned ref.', 'image_not_approved');
    }
    if (!Array.isArray(profile.env)) {
      fail('env', 'Expected literal environment pairs.');
    } else {
      const names = new Set();
      profile.env.forEach((entry, index) => {
        const field = `env[${index}]`;
        if (!object(entry, ['name', 'value'], field)) return;
        if (typeof entry.name !== 'string' || !ENV_NAME.test(entry.name)
            || !Array.isArray(approval?.allowedEnv) || !approval.allowedEnv.includes(entry.name)
            || names.has(entry.name)) {
          fail(`${field}.name`, 'Environment name must be unique and approved for this image.', 'env_not_approved');
        }
        names.add(entry.name);
        if (typeof entry.value !== 'string') fail(`${field}.value`, 'Environment values must be literal strings.');
      });
    }
    if (object(profile.resources, ['cpu', 'memory', 'ephemeralStorage'], 'resources')) {
      for (const key of ['cpu', 'memory', 'ephemeralStorage']) {
        const value = profile.resources[key];
        const quantity = typeof value === 'number' ? String(value) : value;
        if (typeof quantity !== 'string' || !QUANTITY.test(quantity) || !(parseFloat(quantity) > 0)
            || (typeof value === 'number' && !Number.isFinite(value))
            || (key === 'cpu' && !/^(?:\d+(?:\.\d*)?|\.\d+)m?$/.test(quantity))) {
          fail(`resources.${key}`, 'Expected a positive Kubernetes resource quantity.');
        }
      }
    }
    if (!Number.isInteger(profile.maxDurationSeconds) || profile.maxDurationSeconds <= 0 || profile.maxDurationSeconds > 86400) {
      fail('maxDurationSeconds', 'Duration must be an integer from 1 to 86400 seconds.');
    }
    if (!['disabled', 'sandboxed'].includes(profile.codeExecution)) {
      fail('codeExecution', 'Expected disabled or sandboxed.');
    }
    if (profile.runtimeClassName !== undefined
        && (typeof profile.runtimeClassName !== 'string' || !DNS_LABEL.test(profile.runtimeClassName))) {
      fail('runtimeClassName', 'RuntimeClass must be a DNS label.');
    }
    if (profile.codeExecution === 'sandboxed' && !approvedClasses.includes(profile.runtimeClassName)) {
      fail('runtimeClassName', 'Sandboxed execution requires an approved sandbox RuntimeClass.', 'sandbox_required');
    }
    if (object(profile.egress, ['dnsNamespaces', 'allowedNamespaces'], 'egress')) {
      strings(profile.egress.dnsNamespaces, 'egress.dnsNamespaces', DNS_LABEL);
      strings(profile.egress.allowedNamespaces, 'egress.allowedNamespaces', DNS_LABEL);
    }
  }
  return { ok: violations.length === 0, violations };
}
