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

// Functions is maintained as a family source; other families retain the unified
// source. Preserve every served operation and every unrelated component verbatim.
export function mergeFunctionsFamilySource(document, family, version) {
  const result = structuredClone(document);
  const before = reachableComponents(document);
  for (const [path, methods] of Object.entries(result.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation['x-family'] === 'functions' && !family.paths[path]?.[method]) delete methods[method];
    }
    if (Object.keys(methods).length === 0) delete result.paths[path];
  }
  for (const [path, methods] of Object.entries(family.paths)) {
    result.paths[path] ??= {};
    for (const [method, operation] of Object.entries(methods)) {
      if (!isDeepStrictEqual(result.paths[path][method], operation)) {
        result.paths[path][method] = structuredClone(operation);
      }
    }
  }
  for (const [section, components] of Object.entries(family.components ?? {})) {
    result.components[section] ??= {};
    for (const [name, component] of Object.entries(components)) {
      if (!isDeepStrictEqual(result.components[section][name], component)) {
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
