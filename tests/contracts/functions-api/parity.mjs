import { CONFIGURATION_SCHEMAS, operationsOf, resolveRef } from './support.mjs';

// The only places where the contract may carry something the inventory does not.
export const ALLOWED_ADDITIONS = new Set([
  ...CONFIGURATION_SCHEMAS.flatMap((name) => [
    `/components/schemas/${name}/properties/runtimeMode`,
    `/components/schemas/${name}/properties/base`,
  ]),
  '/components/schemas/FunctionProvisioningState/properties/runtimeMode',
  '/components/schemas/FunctionProvisioningState/properties/failureReason',
]);

const escapePointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Order-insensitive keywords whose array form is a set.
const SET_KEYWORDS = new Set(['required']);

// Structural comparison of the contract against the inventory. Every keyword is compared, including any
// keyword that sits beside a $ref, so a sibling default is reported instead of being dropped.
// Returns a list of human-readable differences; an empty list means parity.
export function diffNodes(inventory, contract, pointer = '', allowed = ALLOWED_ADDITIONS, differences = []) {
  if (Array.isArray(inventory) && Array.isArray(contract)) {
    const last = pointer.slice(pointer.lastIndexOf('/') + 1);
    const left = SET_KEYWORDS.has(last) ? [...inventory].sort() : inventory;
    const right = SET_KEYWORDS.has(last) ? [...contract].sort() : contract;
    if (left.length !== right.length) {
      differences.push(`${pointer}: array length ${inventory.length} -> ${contract.length}`);
      return differences;
    }
    left.forEach((item, index) => diffNodes(item, right[index], `${pointer}/${index}`, allowed, differences));
    return differences;
  }
  if (isObject(inventory) && isObject(contract)) {
    for (const key of new Set([...Object.keys(inventory), ...Object.keys(contract)])) {
      const child = `${pointer}/${escapePointer(key)}`;
      if (!(key in contract)) differences.push(`${child}: removed`);
      else if (!(key in inventory)) {
        if (!allowed.has(child)) differences.push(`${child}: added`);
      } else diffNodes(inventory[key], contract[key], child, allowed, differences);
    }
    return differences;
  }
  if (inventory !== contract) differences.push(`${pointer}: ${JSON.stringify(inventory)} -> ${JSON.stringify(contract)}`);
  return differences;
}

// Document-level parity: everything except info.version must match; info.version is the contract's own.
export function diffContracts(inventory, contract) {
  const withoutVersion = (document) => {
    const { version, ...info } = document.info ?? {};
    return { ...document, info };
  };
  return diffNodes(withoutVersion(inventory), withoutVersion(contract));
}

// Every $ref in the document must resolve inside the document.
export function unresolvedRefs(document) {
  const missing = [];
  const walk = (node, where) => {
    if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${where}/${index}`));
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        try {
          resolveRef(document, { $ref: value });
        } catch {
          missing.push(`${where}: ${value}`);
        }
      } else walk(value, `${where}/${escapePointer(key)}`);
    }
  };
  walk(document, '');
  return missing;
}

const PAGINATION_NAMES = new Set(['page[size]', 'page[after]', 'sort', 'search']);

function resolvedParameters(document, operation, pathItem) {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((parameter) => resolveRef(document, parameter));
}

// What a client relies on for paging, idempotent retries and replay, read straight from a document.
export function behaviorOf(document) {
  const behavior = {};
  for (const { route, method, operationId, operation, pathItem } of operationsOf(document)) {
    const parameters = resolvedParameters(document, operation, pathItem);
    const idempotency = parameters.find((parameter) => parameter.in === 'header' && parameter.name.toLowerCase() === 'idempotency-key') ?? null;
    const successStatuses = Object.keys(operation.responses).filter((status) => /^2\d\d$/.test(status));
    const successSchema = successStatuses
      .map((status) => operation.responses[status]?.content?.['application/json']?.schema)
      .find(Boolean);
    const resolvedSuccess = successSchema ? resolveRef(document, successSchema) : null;
    const pageSchema = resolvedSuccess?.properties?.page ? resolveRef(document, resolvedSuccess.properties.page) : null;
    const replay = idempotency?.description?.match(/replay the (original) status and body with (X-Idempotency-Replayed): (true)/);
    behavior[operationId] = {
      route,
      method,
      apiVersion: parameters.find((parameter) => parameter.name === 'X-API-Version')?.schema ?? null,
      pagination: parameters.filter((parameter) => PAGINATION_NAMES.has(parameter.name)).map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        required: parameter.required ?? false,
        schema: parameter.schema,
      })),
      continuationFields: pageSchema ? pageSchema.properties : null,
      idempotency: idempotency
        ? { name: idempotency.name, in: idempotency.in, required: idempotency.required ?? false, schema: idempotency.schema, description: idempotency.description }
        : null,
      replay: replay ? { status: replay[1], header: replay[2], value: replay[3] } : null,
      successStatuses,
      responseStatuses: Object.keys(operation.responses),
    };
  }
  return behavior;
}

export function diffBehavior(inventory, contract) {
  const left = behaviorOf(inventory);
  const right = behaviorOf(contract);
  const differences = [];
  for (const operationId of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!(operationId in right)) differences.push(`${operationId}: operation missing from contract`);
    else if (!(operationId in left)) differences.push(`${operationId}: operation not in inventory`);
    else diffNodes(left[operationId], right[operationId], `/${operationId}`, new Set(), differences);
  }
  return differences;
}

export function operationKeys(document) {
  return operationsOf(document).map(({ route, method, operationId }) => `${method.toUpperCase()} ${route} ${operationId}`).sort();
}
