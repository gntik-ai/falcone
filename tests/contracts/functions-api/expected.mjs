import { loadInventory, operationsOf, resolveRef } from './support.mjs';

// Known-good literals for every pattern the inventory uses in a response. They are independent of the
// contract: a pattern missing here makes the builder throw, so a new pattern cannot slip in unchecked.
const PATTERN_EXEMPLARS = {
  '^(?:fn_[0-9a-f]{8}-[0-9a-f]{3}|res_[0-9a-z]+)$': 'res_abc123',
  '^(?:act_[0-9a-f]{8}-[0-9a-f]{3}|act_[0-9a-z]{1,64})$': 'act_0a1b2c3d-4e5',
  '^(?:act_[0-9a-f]{8}-[0-9a-f]{3}|inv_[0-9a-z]{1,64})$': 'inv_abc123',
  '^[a-z][a-z0-9-]{1,62}$': 'legacy-fn',
  '^[A-Za-z0-9._:-]{8,128}$': 'corr-legacy-0001',
  '^2026-03-26$': '2026-03-26',
  '^GW_[A-Z0-9_]+$': 'GW_VALIDATION_ERROR',
  '^fnv_[0-9a-z]+$': 'fnv_abc123',
  '^inv_[0-9a-z]+$': 'inv_abc123',
  '^trg_[0-9a-z]+$': 'trg_abc123',
  '^exp_[0-9a-z]+$': 'exp_abc123',
  '^res_[0-9a-z]+$': 'res_abc123',
  '^ktr_[0-9a-z-]+$': 'ktr_abc-123',
  '^[A-Z][A-Z0-9_]{0,63}$': 'LEGACY_SECRET',
  '^[a-z][a-z0-9_-]{0,62}$': 'legacy_secret',
  '^[A-Za-z_][A-Za-z0-9_]*$': 'legacy_name',
  '^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])?$': 'legacy-1',
};

const FORMAT_EXEMPLARS = {
  'date-time': '2026-11-03T00:00:00Z',
  uri: 'https://example.test/legacy',
};

const MAX_DEPTH = 12;

// Builds the smallest instance of an inventory schema: required properties only, first enum value.
export function exemplar(document, schema, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('schema nesting exceeds the exemplar depth');
  const node = resolveRef(document, schema);
  if ('const' in node) return node.const;
  if (node.enum) return node.enum[0];
  if (node.allOf) return Object.assign({}, ...node.allOf.map((part) => exemplar(document, part, depth + 1)));
  if (node.oneOf) return exemplar(document, node.oneOf[0], depth + 1);
  if (node.anyOf) return exemplar(document, node.anyOf[0], depth + 1);
  const declared = Array.isArray(node.type) ? node.type.find((type) => type !== 'null') : node.type;
  const type = declared ?? (node.properties ? 'object' : 'string');
  switch (type) {
    case 'object': {
      const value = {};
      for (const name of node.required ?? []) {
        if (!node.properties?.[name]) throw new Error(`required property ${name} has no schema`);
        value[name] = exemplar(document, node.properties[name], depth + 1);
      }
      return value;
    }
    case 'array': {
      const count = Math.max(node.minItems ?? 0, 1);
      return Array.from({ length: count }, () => exemplar(document, node.items ?? {}, depth + 1));
    }
    case 'string': {
      if (node.pattern) {
        if (!(node.pattern in PATTERN_EXEMPLARS)) throw new Error(`no exemplar for pattern ${node.pattern}`);
        return PATTERN_EXEMPLARS[node.pattern];
      }
      if (node.format) {
        if (!(node.format in FORMAT_EXEMPLARS)) throw new Error(`no exemplar for format ${node.format}`);
        return FORMAT_EXEMPLARS[node.format];
      }
      return 'a'.repeat(Math.max(node.minLength ?? 0, 1));
    }
    case 'integer':
    case 'number':
      return node.minimum ?? 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      throw new Error(`unsupported schema type ${type}`);
  }
}

const SUCCESS = /^2\d\d$/;
const ERROR_STATUS = '400';

// Expected outcome of one inventory operation, built only from a freshly read inventory: the first
// success status with its body, and the 400 error envelope with its body.
export function buildExpected(operationId) {
  const inventory = loadInventory();
  const entry = operationsOf(inventory).find((candidate) => candidate.operationId === operationId);
  if (!entry) throw new Error(`operation ${operationId} is not in the inventory`);
  const statusCode = Object.keys(entry.operation.responses).find((status) => SUCCESS.test(status));
  const success = entry.operation.responses[statusCode];
  const bodySchema = success.content?.['application/json']?.schema;
  const error = entry.operation.responses[ERROR_STATUS];
  return {
    operationId,
    response: {
      status: Number(statusCode),
      body: bodySchema ? exemplar(inventory, bodySchema) : undefined,
    },
    error: {
      status: Number(ERROR_STATUS),
      body: exemplar(inventory, error.content['application/json'].schema),
    },
  };
}

// Sorted list of every field path in a value, so two results can be compared by shape.
export function fieldSet(value, prefix = '') {
  if (Array.isArray(value)) return value.flatMap((item) => fieldSet(item, `${prefix}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [`${prefix}.${key}`, ...fieldSet(child, `${prefix}.${key}`)]).sort();
  }
  return [];
}

// True when the two values share no object or array instance.
export function sharesNoReferences(left, right) {
  const seen = new Set();
  const collect = (value) => {
    if (value !== null && typeof value === 'object') {
      seen.add(value);
      Object.values(value).forEach(collect);
    }
  };
  collect(left);
  let shared = false;
  const probe = (value) => {
    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) shared = true;
      Object.values(value).forEach(probe);
    }
  };
  probe(right);
  return !shared;
}
