const STORAGE_PROVIDER_CAPABILITY_TEMPLATE = Object.freeze({
  bucketOperations: false,
  objectCrud: false,
  presignedUrls: false,
  multipartUpload: false,
  objectVersioning: false
});

export const STORAGE_PROVIDER_CAPABILITY_FIELDS = Object.freeze(
  Object.keys(STORAGE_PROVIDER_CAPABILITY_TEMPLATE)
);

export const STORAGE_PROVIDER_ERROR_CODES = Object.freeze({
  MISSING_PROVIDER_TYPE: 'MISSING_PROVIDER_TYPE',
  UNKNOWN_PROVIDER_TYPE: 'UNKNOWN_PROVIDER_TYPE',
  AMBIGUOUS_PROVIDER_SELECTION: 'AMBIGUOUS_PROVIDER_SELECTION',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  PROVIDER_BASELINE_UNSATISFIED: 'PROVIDER_BASELINE_UNSATISFIED'
});

export const STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES = Object.freeze({
  SATISFIED: 'satisfied',
  PARTIALLY_SATISFIED: 'partially_satisfied',
  UNSATISFIED: 'unsatisfied'
});

export const STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION = 'v2';
export const STORAGE_PROVIDER_CAPABILITY_BASELINE_VERSION = 'v1';
export const DEFAULT_STORAGE_PROVIDER_TYPE = 'minio';

const REQUIRED_BASELINE_CAPABILITIES = Object.freeze([
  'bucket.create',
  'bucket.delete',
  'bucket.list',
  'object.put',
  'object.get',
  'object.delete',
  'object.list',
  'object.metadata.get',
  'object.content_type.preserve',
  'object.integrity.etag_or_checksum',
  'object.list.pagination.deterministic',
  'object.conditional.if_match',
  'object.conditional.if_none_match'
]);

const OPTIONAL_EXTENDED_CAPABILITIES = Object.freeze([
  'bucket.presigned_urls',
  'object.multipart_upload',
  'object.versioning'
]);

export const STORAGE_PROVIDER_CAPABILITY_IDS = Object.freeze([
  ...REQUIRED_BASELINE_CAPABILITIES,
  ...OPTIONAL_EXTENDED_CAPABILITIES
]);

function withCapabilityDefaults(overrides = {}) {
  return Object.freeze({
    ...STORAGE_PROVIDER_CAPABILITY_TEMPLATE,
    ...overrides
  });
}

function buildCapabilityConstraint({ key, operator = '=', value, unit = null, note = null }) {
  return Object.freeze({
    key,
    operator,
    value,
    ...(unit ? { unit } : {}),
    ...(note ? { note } : {})
  });
}

function buildCapabilityEntry({
  capabilityId,
  state = STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.UNSATISFIED,
  required = false,
  summary,
  constraints = []
}) {
  return Object.freeze({
    capabilityId,
    required,
    state,
    summary,
    constraints: Object.freeze(constraints.map((constraint) => ({ ...constraint })))
  });
}

function buildCapabilityEntries(overrides = {}) {
  return STORAGE_PROVIDER_CAPABILITY_IDS.map((capabilityId) => {
    const entry = overrides[capabilityId] ?? {};
    return buildCapabilityEntry({
      capabilityId,
      required: REQUIRED_BASELINE_CAPABILITIES.includes(capabilityId),
      state: entry.state,
      summary: entry.summary ?? `Capability ${capabilityId}.`,
      constraints: entry.constraints ?? []
    });
  });
}

function deriveBooleanManifestFromEntries(entries) {
  const map = Object.fromEntries(entries.map((entry) => [entry.capabilityId, entry]));
  const isSatisfied = (capabilityId) => map[capabilityId]?.state === STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED;

  return withCapabilityDefaults({
    bucketOperations: ['bucket.create', 'bucket.delete', 'bucket.list'].every(isSatisfied),
    objectCrud: ['object.put', 'object.get', 'object.delete', 'object.list', 'object.metadata.get'].every(isSatisfied),
    presignedUrls: isSatisfied('bucket.presigned_urls'),
    multipartUpload: isSatisfied('object.multipart_upload'),
    objectVersioning: isSatisfied('object.versioning')
  });
}

function buildStorageProviderLimitation({ code, summary, affectsCapabilities = [] }) {
  return Object.freeze({ code, summary, affectsCapabilities: Object.freeze([...affectsCapabilities]) });
}

function buildCapabilityBaseline(entries, checkedAt = '2026-03-27T00:00:00Z') {
  const requiredEntries = entries.filter((entry) => entry.required);
  const missingCapabilities = requiredEntries
    .filter((entry) => entry.state === STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.UNSATISFIED)
    .map((entry) => ({
      capabilityId: entry.capabilityId,
      expectedState: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED,
      actualState: entry.state
    }));
  const insufficientCapabilities = requiredEntries
    .filter((entry) => entry.state === STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.PARTIALLY_SATISFIED)
    .map((entry) => ({
      capabilityId: entry.capabilityId,
      expectedState: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED,
      actualState: entry.state,
      constraints: entry.constraints.map((constraint) => ({ ...constraint }))
    }));

  return {
    version: STORAGE_PROVIDER_CAPABILITY_BASELINE_VERSION,
    checkedAt,
    requiredCapabilities: [...REQUIRED_BASELINE_CAPABILITIES],
    optionalCapabilities: [...OPTIONAL_EXTENDED_CAPABILITIES],
    eligible: missingCapabilities.length === 0 && insufficientCapabilities.length === 0,
    missingCapabilities,
    insufficientCapabilities
  };
}

function buildCapabilityProfile(overrides, checkedAt) {
  const capabilityDetails = buildCapabilityEntries(overrides);

  return {
    capabilityManifestVersion: STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION,
    capabilityManifest: deriveBooleanManifestFromEntries(capabilityDetails),
    capabilityDetails,
    capabilityBaseline: buildCapabilityBaseline(capabilityDetails, checkedAt)
  };
}

function buildProviderDefinition({
  providerType,
  displayName,
  backendFamily,
  selectionKeys,
  configuredVia,
  defaultRegion,
  capabilityEntries,
  limitations = []
}) {
  const capabilityProfile = buildCapabilityProfile(capabilityEntries, '2026-03-27T00:00:00Z');

  return Object.freeze({
    providerType,
    displayName,
    backendFamily,
    selectionKeys: Object.freeze([...selectionKeys]),
    configuredVia,
    defaultRegion,
    capabilityManifestVersion: capabilityProfile.capabilityManifestVersion,
    capabilityManifest: capabilityProfile.capabilityManifest,
    capabilityDetails: Object.freeze(capabilityProfile.capabilityDetails),
    capabilityBaseline: Object.freeze(capabilityProfile.capabilityBaseline),
    limitations: Object.freeze(limitations)
  });
}

const STANDARD_OBJECT_CONSTRAINTS = Object.freeze([
  buildCapabilityConstraint({ key: 'maxObjectSizeBytes', operator: '<=', value: 'provider_defined', note: 'Provider-specific maximum object size applies.' }),
  buildCapabilityConstraint({ key: 'maxObjectKeyLength', operator: '<=', value: 1024, unit: 'characters' })
]);

const STANDARD_PAGINATION_CONSTRAINTS = Object.freeze([
  buildCapabilityConstraint({ key: 'ordering', value: 'lexicographic' }),
  buildCapabilityConstraint({ key: 'continuationTokenFormat', value: 'opaque' })
]);

const STANDARD_CONDITIONAL_CONSTRAINTS = Object.freeze([
  buildCapabilityConstraint({ key: 'header', value: 'if-match' })
]);

const STANDARD_IF_NONE_MATCH_CONSTRAINTS = Object.freeze([
  buildCapabilityConstraint({ key: 'header', value: 'if-none-match' })
]);

const STORAGE_PROVIDER_DEFINITIONS = Object.freeze({
  minio: buildProviderDefinition({
    providerType: 'minio',
    displayName: 'MinIO',
    backendFamily: 's3-compatible',
    selectionKeys: ['minio'],
    configuredVia: 'storage.config.inline.providerType',
    defaultRegion: 'us-east-1',
    capabilityEntries: {
      'bucket.create': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Creates workspace buckets.' },
      'bucket.delete': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Deletes eligible buckets.' },
      'bucket.list': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Lists scoped buckets.' },
      'object.put': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Stores objects.', constraints: STANDARD_OBJECT_CONSTRAINTS },
      'object.get': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Downloads object content.' },
      'object.delete': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Deletes scoped objects.' },
      'object.list': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Lists bucket objects.' },
      'object.metadata.get': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Fetches HEAD-style object metadata.' },
      'object.content_type.preserve': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Preserves content type metadata on write and read.' },
      'object.integrity.etag_or_checksum': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Returns an ETag or checksum on upload responses.' },
      'object.list.pagination.deterministic': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Provides deterministic object listing pagination.', constraints: STANDARD_PAGINATION_CONSTRAINTS },
      'object.conditional.if_match': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports If-Match conditional requests.', constraints: STANDARD_CONDITIONAL_CONSTRAINTS },
      'object.conditional.if_none_match': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports If-None-Match conditional requests.', constraints: STANDARD_IF_NONE_MATCH_CONSTRAINTS },
      'bucket.presigned_urls': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports presigned URL flows for future storage increments.' },
      'object.multipart_upload': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports multipart upload flows.', constraints: [buildCapabilityConstraint({ key: 'maxParts', operator: '<=', value: 10000 })] },
      'object.versioning': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports object versioning.' }
    }
  }),
  'ceph-rgw': buildProviderDefinition({
    providerType: 'ceph-rgw',
    displayName: 'Ceph RGW',
    backendFamily: 's3-compatible',
    selectionKeys: ['ceph-rgw', 'ceph_rgw', 'cephrgw'],
    configuredVia: 'storage.config.inline.providerType',
    defaultRegion: 'default',
    capabilityEntries: {
      'bucket.create': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Creates workspace buckets.' },
      'bucket.delete': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Deletes eligible buckets.' },
      'bucket.list': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Lists scoped buckets.' },
      'object.put': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Stores objects.', constraints: STANDARD_OBJECT_CONSTRAINTS },
      'object.get': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Downloads object content.' },
      'object.delete': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Deletes scoped objects.' },
      'object.list': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Lists bucket objects.' },
      'object.metadata.get': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Fetches HEAD-style object metadata.' },
      'object.content_type.preserve': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Preserves content type metadata on write and read.' },
      'object.integrity.etag_or_checksum': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Returns an ETag or checksum on upload responses.' },
      'object.list.pagination.deterministic': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Provides deterministic object listing pagination.', constraints: STANDARD_PAGINATION_CONSTRAINTS },
      'object.conditional.if_match': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports If-Match conditional requests.', constraints: STANDARD_CONDITIONAL_CONSTRAINTS },
      'object.conditional.if_none_match': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports If-None-Match conditional requests.', constraints: STANDARD_IF_NONE_MATCH_CONSTRAINTS },
      'bucket.presigned_urls': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports presigned URL flows for future storage increments.' },
      'object.multipart_upload': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports multipart upload flows.', constraints: [buildCapabilityConstraint({ key: 'maxParts', operator: '<=', value: 10000 })] },
      'object.versioning': {
        state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.PARTIALLY_SATISFIED,
        summary: 'Object versioning may depend on the Ceph RGW deployment policy.',
        constraints: [buildCapabilityConstraint({ key: 'deploymentPolicy', value: 'environment_specific' })]
      }
    },
    limitations: [
      buildStorageProviderLimitation({
        code: 'PROVIDER_VERSIONING_POLICY_DEPLOYMENT_SPECIFIC',
        summary: 'Object versioning support may depend on the Ceph RGW deployment policy.',
        affectsCapabilities: ['object.versioning']
      })
    ]
  }),
  garage: buildProviderDefinition({
    providerType: 'garage',
    displayName: 'Garage',
    backendFamily: 's3-compatible',
    selectionKeys: ['garage'],
    configuredVia: 'storage.config.inline.providerType',
    defaultRegion: 'garage',
    capabilityEntries: {
      'bucket.create': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Creates workspace buckets.' },
      'bucket.delete': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Deletes eligible buckets.' },
      'bucket.list': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Lists scoped buckets.' },
      'object.put': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Stores objects.', constraints: STANDARD_OBJECT_CONSTRAINTS },
      'object.get': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Downloads object content.' },
      'object.delete': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Deletes scoped objects.' },
      'object.list': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Lists bucket objects.' },
      'object.metadata.get': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Fetches HEAD-style object metadata.' },
      'object.content_type.preserve': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Preserves content type metadata on write and read.' },
      'object.integrity.etag_or_checksum': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Returns an ETag or checksum on upload responses.' },
      'object.list.pagination.deterministic': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Provides deterministic object listing pagination.', constraints: STANDARD_PAGINATION_CONSTRAINTS },
      'object.conditional.if_match': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports If-Match conditional requests.', constraints: STANDARD_CONDITIONAL_CONSTRAINTS },
      'object.conditional.if_none_match': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports If-None-Match conditional requests.', constraints: STANDARD_IF_NONE_MATCH_CONSTRAINTS },
      'bucket.presigned_urls': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports presigned URL flows for future storage increments.' },
      'object.multipart_upload': { state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.SATISFIED, summary: 'Supports multipart upload flows.', constraints: [buildCapabilityConstraint({ key: 'maxParts', operator: '<=', value: 10000 })] },
      'object.versioning': {
        state: STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES.UNSATISFIED,
        summary: 'Object versioning is not assumed in the common abstraction profile for Garage.'
      }
    },
    limitations: [
      buildStorageProviderLimitation({
        code: 'OBJECT_VERSIONING_NOT_ASSUMED',
        summary: 'Object versioning is not assumed in the common abstraction profile for Garage.',
        affectsCapabilities: ['object.versioning']
      })
    ]
  })
});

export const SUPPORTED_STORAGE_PROVIDER_TYPES = Object.freeze(
  Object.keys(STORAGE_PROVIDER_DEFINITIONS)
);

function normalizeProviderType(rawProviderType) {
  if (typeof rawProviderType !== 'string') {
    return null;
  }

  const normalized = rawProviderType.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const definition of Object.values(STORAGE_PROVIDER_DEFINITIONS)) {
    if (definition.selectionKeys.includes(normalized)) {
      return definition.providerType;
    }
  }

  return normalized;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cloneCapabilityEntry(entry) {
  return {
    capabilityId: entry.capabilityId,
    required: entry.required,
    state: entry.state,
    summary: entry.summary,
    constraints: entry.constraints.map((constraint) => ({ ...constraint }))
  };
}

function cloneCapabilityBaseline(baseline) {
  return {
    version: baseline.version,
    checkedAt: baseline.checkedAt,
    requiredCapabilities: [...baseline.requiredCapabilities],
    optionalCapabilities: [...baseline.optionalCapabilities],
    eligible: baseline.eligible,
    missingCapabilities: baseline.missingCapabilities.map((entry) => ({ ...entry })),
    insufficientCapabilities: baseline.insufficientCapabilities.map((entry) => ({
      ...entry,
      constraints: (entry.constraints ?? []).map((constraint) => ({ ...constraint }))
    }))
  };
}

function cloneDefinition(definition) {
  return {
    providerType: definition.providerType,
    displayName: definition.displayName,
    backendFamily: definition.backendFamily,
    selectionKeys: [...definition.selectionKeys],
    configuredVia: definition.configuredVia,
    defaultRegion: definition.defaultRegion,
    capabilityManifestVersion: definition.capabilityManifestVersion,
    capabilityManifest: { ...definition.capabilityManifest },
    capabilityDetails: definition.capabilityDetails.map((entry) => cloneCapabilityEntry(entry)),
    capabilityBaseline: cloneCapabilityBaseline(definition.capabilityBaseline),
    limitations: definition.limitations.map((entry) => ({ ...entry, affectsCapabilities: [...(entry.affectsCapabilities ?? [])] }))
  };
}

function collectConfiguredProviderCandidates(input = {}) {
  const candidates = [
    ['providerType', input.providerType],
    ['storage.provider.type', input?.storage?.provider?.type],
    ['storage.provider.selection.type', input?.storage?.provider?.selection?.type],
    ['storage.config.inline.providerType', input?.storage?.config?.inline?.providerType],
    ['storage.config.inline.providerSelection.type', input?.storage?.config?.inline?.providerSelection?.type],
    ['storage.config.inline.providerProfile', input?.storage?.config?.inline?.providerProfile]
  ].map(([source, value]) => ({
    source,
    value: normalizeProviderType(value)
  }));

  return candidates.filter((entry) => entry.value);
}

function buildUnavailableCapabilityManifest() {
  return withCapabilityDefaults();
}

function buildUnavailableCapabilityDetails() {
  return buildCapabilityEntries();
}

export function listSupportedStorageProviders() {
  return SUPPORTED_STORAGE_PROVIDER_TYPES.map((providerType) => cloneDefinition(STORAGE_PROVIDER_DEFINITIONS[providerType]));
}

export function isStorageProviderTypeSupported(providerType) {
  return SUPPORTED_STORAGE_PROVIDER_TYPES.includes(normalizeProviderType(providerType));
}

export function buildStorageCapabilityManifest(providerType) {
  const normalized = normalizeProviderType(providerType);
  const definition = normalized ? STORAGE_PROVIDER_DEFINITIONS[normalized] : null;
  return definition ? { ...definition.capabilityManifest } : buildUnavailableCapabilityManifest();
}

export function buildStorageCapabilityDetails(providerType) {
  const normalized = normalizeProviderType(providerType);
  const definition = normalized ? STORAGE_PROVIDER_DEFINITIONS[normalized] : null;
  return definition ? definition.capabilityDetails.map((entry) => cloneCapabilityEntry(entry)) : buildUnavailableCapabilityDetails();
}

export function buildStorageCapabilityBaseline(providerType) {
  const normalized = normalizeProviderType(providerType);
  const definition = normalized ? STORAGE_PROVIDER_DEFINITIONS[normalized] : null;
  return definition ? cloneCapabilityBaseline(definition.capabilityBaseline) : buildCapabilityBaseline(buildUnavailableCapabilityDetails());
}

export function resolveStorageProviderConfig(input = {}) {
  const candidates = collectConfiguredProviderCandidates(input);
  const configuredTypes = unique(candidates.map((entry) => entry.value));

  if (configuredTypes.length > 1) {
    return {
      configured: true,
      providerType: null,
      configuredVia: candidates.map((entry) => entry.source),
      errorCode: STORAGE_PROVIDER_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION,
      message: 'Multiple conflicting storage provider selections were supplied.'
    };
  }

  if (!configuredTypes.length) {
    return {
      configured: false,
      providerType: null,
      configuredVia: 'none',
      errorCode: STORAGE_PROVIDER_ERROR_CODES.MISSING_PROVIDER_TYPE,
      message: 'No explicit storage provider type was configured.'
    };
  }

  const providerType = configuredTypes[0];
  const match = candidates.find((entry) => entry.value === providerType);

  if (!STORAGE_PROVIDER_DEFINITIONS[providerType]) {
    return {
      configured: true,
      providerType,
      configuredVia: match?.source ?? 'unknown',
      errorCode: STORAGE_PROVIDER_ERROR_CODES.UNKNOWN_PROVIDER_TYPE,
      message: `Storage provider type \`${providerType}\` is not supported.`
    };
  }

  return {
    configured: true,
    providerType,
    configuredVia: match?.source ?? STORAGE_PROVIDER_DEFINITIONS[providerType].configuredVia,
    errorCode: null,
    message: null
  };
}

export function buildStorageUnavailableProfile(reason = STORAGE_PROVIDER_ERROR_CODES.STORAGE_UNAVAILABLE, details = {}) {
  const normalizedReason = reason || STORAGE_PROVIDER_ERROR_CODES.STORAGE_UNAVAILABLE;
  const summary = details.message
    ?? (normalizedReason === STORAGE_PROVIDER_ERROR_CODES.MISSING_PROVIDER_TYPE
      ? 'No storage provider type has been configured.'
      : normalizedReason === STORAGE_PROVIDER_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION
        ? 'Storage provider selection is ambiguous.'
        : normalizedReason === STORAGE_PROVIDER_ERROR_CODES.UNKNOWN_PROVIDER_TYPE
          ? 'Storage provider type is not supported.'
          : 'Storage provider abstraction is unavailable.');
  const capabilityDetails = buildUnavailableCapabilityDetails();
  const capabilityBaseline = buildCapabilityBaseline(capabilityDetails);

  return {
    providerType: details.providerType ?? null,
    status: 'unavailable',
    backendFamily: 's3-compatible',
    configured: Boolean(details.configured),
    configuredVia: details.configuredVia ?? 'none',
    capabilityManifestVersion: STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION,
    capabilityManifest: buildUnavailableCapabilityManifest(),
    capabilityDetails,
    capabilityBaseline,
    limitations: [
      buildStorageProviderLimitation({
        code: normalizedReason,
        summary
      })
    ],
    errorCode: normalizedReason,
    selectionMode: 'explicit',
    supportedProviderTypes: [...SUPPORTED_STORAGE_PROVIDER_TYPES]
  };
}

export function buildStorageProviderProfile(input = {}) {
  const resolution = resolveStorageProviderConfig(input);

  if (resolution.errorCode) {
    return buildStorageUnavailableProfile(resolution.errorCode, resolution);
  }

  const definition = STORAGE_PROVIDER_DEFINITIONS[resolution.providerType];

  return {
    providerType: definition.providerType,
    status: 'ready',
    backendFamily: definition.backendFamily,
    configured: true,
    configuredVia: resolution.configuredVia,
    capabilityManifestVersion: definition.capabilityManifestVersion,
    capabilityManifest: { ...definition.capabilityManifest },
    capabilityDetails: definition.capabilityDetails.map((entry) => cloneCapabilityEntry(entry)),
    capabilityBaseline: cloneCapabilityBaseline(definition.capabilityBaseline),
    limitations: definition.limitations.map((entry) => ({
      code: entry.code,
      summary: entry.summary,
      affectsCapabilities: [...(entry.affectsCapabilities ?? [])]
    })),
    errorCode: null,
    selectionMode: 'explicit',
    supportedProviderTypes: [...SUPPORTED_STORAGE_PROVIDER_TYPES],
    displayName: definition.displayName,
    defaultRegion: definition.defaultRegion
  };
}

export function summarizeStorageProviderCompatibility(input = {}) {
  const profile = buildStorageProviderProfile(input);

  return {
    providerType: profile.providerType,
    status: profile.status,
    supportedProviderTypes: [...profile.supportedProviderTypes],
    capabilityCount: STORAGE_PROVIDER_CAPABILITY_FIELDS.filter((field) => profile.capabilityManifest[field]).length,
    capabilityManifestVersion: profile.capabilityManifestVersion,
    capabilityManifest: { ...profile.capabilityManifest },
    capabilityDetails: profile.capabilityDetails.map((entry) => cloneCapabilityEntry(entry)),
    capabilityBaseline: cloneCapabilityBaseline(profile.capabilityBaseline),
    limitations: profile.limitations.map((entry) => ({ ...entry, affectsCapabilities: [...(entry.affectsCapabilities ?? [])] })),
    configuredVia: profile.configuredVia,
    errorCode: profile.errorCode
  };
}
