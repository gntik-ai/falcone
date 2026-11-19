import { expect as baseExpect } from '@playwright/test';

let activeCheckpoint;
const originals = new WeakMap(), checkpoints = new WeakMap();
const unwrap = (value) => originals.get(value) ?? value;
const actions = new Set(['click', 'dblclick', 'fill', 'clear', 'press', 'check', 'uncheck', 'setChecked', 'selectOption', 'tap', 'hover', 'focus', 'dragTo', 'setInputFiles', 'goto', 'reload', 'goBack', 'goForward', 'setViewportSize', 'evaluate', 'waitFor', 'waitForURL', 'waitForLoadState', 'screenshot']);
function options(value) {
  if (!value || typeof value !== 'object') return value;
  if (originals.has(value)) return unwrap(value);
  if (Array.isArray(value)) return value.map(options);
  if (Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, options(v)]));
  return value;
}
function wrapBrowser(target, settled, cache) {
  if (!target || typeof target !== 'object') return target;
  if (cache.has(target)) return cache.get(target);
  const proxy = new Proxy(target, {
    get(object, name) {
      const value = Reflect.get(object, name, object);
      if (typeof value !== 'function') {
        return ['keyboard', 'mouse', 'touchscreen'].includes(name) ? wrapBrowser(value, settled, cache) : value;
      }
      return (...args) => {
        const result = value.apply(object, args.map(options));
        if (result?.then) return result.then(async (answer) => {
          if (actions.has(name) || String(name).startsWith('waitFor')) await settled();
          return Array.isArray(answer) ? answer.map((item) => item && typeof item.locator === 'function' ? wrapBrowser(item, settled, cache) : item) : answer;
        });
        // Page/Locator factory methods return locators synchronously.
        if (result && typeof result === 'object' && typeof result.locator === 'function') return wrapBrowser(result, settled, cache);
        return result;
      };
    },
  });
  originals.set(proxy, target); checkpoints.set(proxy, settled); checkpoints.set(target, settled); cache.set(target, proxy);
  return proxy;
}
function matchers(result, settled) {
  return new Proxy(result, { get(target, name) {
    const value = target[name];
    if (typeof value === 'function') return (...args) => {
      const answer = value.apply(target, args.map(options));
      return answer?.then ? answer.then(async (v) => { await (settled ?? activeCheckpoint)?.(); return v; }) : answer;
    };
    return value && typeof value === 'object' ? matchers(value, settled) : value;
  } });
}
export const expect = new Proxy(baseExpect, {
  apply(target, self, args) { return matchers(Reflect.apply(target, self, args.map(options)), checkpoints.get(args[0])); },
  get(target, name) {
    const value = target[name];
    return ['soft', 'poll'].includes(name) ? new Proxy(value, { apply(fn, self, args) { return matchers(Reflect.apply(fn, self, args.map(options)), checkpoints.get(args[0])); } }) : value;
  },
});
// This fixture-level proxy covers journeys that use `page` directly. The
// checkpoint is installed by the automatic parity fixture before the test runs.
export function guardBrowserPage(page) {
  return wrapBrowser(page, async () => { await activeCheckpoint?.(); }, new WeakMap());
}
export function guardParity(parity, check) {
  const raw = { ...parity, page: unwrap(parity.page) };
  const settled = () => check(raw);
  activeCheckpoint = settled;
  return {
    dispose() { if (activeCheckpoint === settled) activeCheckpoint = undefined; },
    ...parity, page: wrapBrowser(raw.page, settled, new WeakMap()), settled,
    async open(...args) { await parity.open(...args); await settled(); },
  };
}
