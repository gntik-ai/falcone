import { isDeepStrictEqual } from 'node:util';

function reachableComponents(document) {
  const refs = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/') && !refs.has(value.$ref)) {
      refs.add(value.$ref);
      const [, , section, name] = value.$ref.split('/');
      visit(document.components?.[section]?.[name]);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(document.paths);
  visit(document.security);
  return refs;
}

// Family-specific components follow the maintained family source. Shared
// components must agree with the unified source to avoid merge-order data loss.
// Additions explicitly maintained in the unified contract survive composition
// with an older generated family document, which must not overwrite them.
export function mergePublicApiFamilySource(document, family, version, familyId) {
  const result = structuredClone(document);
  const before = reachableComponents(document);
  const unified = reachableComponents({
    ...document,
    paths: Object.fromEntries(Object.entries(document.paths).map(([path, methods]) => [
      path,
      Object.fromEntries(Object.entries(methods).filter(([, operation]) => operation?.['x-contract-source'] === 'unified')),
    ])),
  });
  const shared = reachableComponents({
    ...document,
    paths: Object.fromEntries(Object.entries(document.paths).map(([path, methods]) => [
      path,
      Object.fromEntries(Object.entries(methods).filter(([, operation]) => operation?.['x-family'] !== familyId)),
    ])),
  });
  for (const [path, methods] of Object.entries(result.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation['x-family'] === familyId && operation['x-contract-source'] !== 'unified' && !family.paths[path]?.[method]) delete methods[method];
    }
    if (Object.keys(methods).length === 0) delete result.paths[path];
  }
  for (const [path, methods] of Object.entries(family.paths)) {
    result.paths[path] ??= {};
    for (const [method, operation] of Object.entries(methods)) {
      if (result.paths[path][method]?.['x-contract-source'] === 'unified') continue;
      if (!isDeepStrictEqual(result.paths[path][method], operation)) {
        result.paths[path][method] = structuredClone(operation);
      }
    }
  }
  for (const [section, components] of Object.entries(family.components ?? {})) {
    result.components[section] ??= {};
    for (const [name, component] of Object.entries(components)) {
      // The shared HTTP retry contract is maintained in the unified document. A generated
      // family from the previous generation must not overwrite that source of truth.
      if (section === 'parameters' && name === 'IdempotencyKey' && document.components?.parameters?.IdempotencyKey) continue;
      if (!isDeepStrictEqual(result.components[section][name], component)) {
        const ref = `#/components/${section}/${name}`;
        if (unified.has(ref) && !shared.has(ref)) continue;
        if (shared.has(ref)) {
          throw new Error(`Shared component conflict in ${familyId}: ${ref}. Synchronize the unified contract and maintained family sources before generation.`);
        }
        result.components[section][name] = structuredClone(component);
      }
    }
  }
  const after = reachableComponents(result);
  for (const ref of before) {
    const [, , section, name] = ref.split('/');
    if (section === 'schemas' && !after.has(ref)) delete result.components.schemas[name];
  }
  result.info.version = version;
  return result;
}
