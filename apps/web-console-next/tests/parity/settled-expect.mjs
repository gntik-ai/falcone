import { expect as baseExpect } from '@playwright/test';

// The parity fixture of the test that is running in this worker (tests run one at a time per worker), and whether its
// page is a real browser page. Unit tests drive the fixture with page doubles that have no document to inspect.
let current;
export function trackParity(parity, live) {
  current = { parity, live, settling: false };
  return () => { current = undefined; };
}
export const trackedParity = () => current?.parity;
// assertNoSampleData runs on every settled state: after open(), after every action and readiness assertion a journey runs,
// after every check in checks.mjs, and once more before teardown. Calls made while it runs do not settle again.
export async function settle() {
  if (!current?.live || current.settling) return;
  current.settling = true;
  try { await current.parity.assertNoSampleData(); } finally { current.settling = false; }
}
const wrapMatchers = (matchers) => new Proxy(matchers, {
  get(target, property) {
    const value = Reflect.get(target, property);
    if (['not', 'resolves', 'rejects'].includes(property)) return wrapMatchers(value);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const result = value.apply(target, args);
      return typeof result?.then === 'function' ? result.then(async (outcome) => { await settle(); return outcome; }) : result;
    };
  },
});
// Every awaited matcher is a readiness assertion and is followed by the sample-data check. Journeys, and the page helpers
// they share, import this expect instead of the Playwright one. expect.poll and expect.soft return matchers too.
export const expect = new Proxy(baseExpect, {
  apply: (target, thisArg, args) => wrapMatchers(Reflect.apply(target, thisArg, args)),
  get(target, property) {
    const value = Reflect.get(target, property);
    if (['poll', 'soft'].includes(property) && typeof value === 'function') return (...args) => wrapMatchers(value.apply(target, args));
    return value;
  },
});
export { baseExpect };
