// Runs the no-sample-data check on every settled state of a parity journey: after open() (harness.mjs), after every
// Locator/keyboard/mouse action, after every web-first readiness assertion (the `expect` exported here wraps
// Playwright's; journey helpers import it from here, never from @playwright/test), after every Locator.waitFor and
// Page.waitFor* readiness call, and once more before teardown (harness.mjs). The check itself is assertNoSampleData
// in checks.mjs.
import { expect as playwrightExpect } from '@playwright/test';

let current = null;
let check = async () => {};
let running = false;

export function bindSampleDataGuard(parity, assertNoSampleData) {
  current = parity;
  check = assertNoSampleData;
}
export function unbindSampleDataGuard() { current = null; }

export async function settled() {
  if (!current || running || current.page.isClosed()) return;
  running = true;
  try { await check(current); } finally { running = false; }
}

const ACTIONS = ['click', 'dblclick', 'tap', 'fill', 'clear', 'press', 'pressSequentially', 'type', 'check', 'uncheck', 'setChecked', 'selectOption', 'selectText', 'setInputFiles', 'hover', 'focus', 'blur', 'dispatchEvent', 'dragTo', 'waitFor'];
let patched = false;
// Journeys drive the page through Locators, page.keyboard and page.mouse: wrap their action and readiness methods once per worker.
export function guardActions(page) {
  if (patched) return;
  patched = true;
  const prototypes = [[Object.getPrototypeOf(page.locator('body')), ACTIONS], [Object.getPrototypeOf(page), ['waitForSelector', 'waitForURL', 'waitForFunction']], [Object.getPrototypeOf(page.keyboard), ['press', 'type', 'insertText']], [Object.getPrototypeOf(page.mouse), ['click', 'dblclick', 'up', 'wheel']]];
  for (const [prototype, names] of prototypes) {
    for (const name of names) {
      const original = prototype[name];
      if (typeof original !== 'function') continue;
      prototype[name] = async function guardedAction(...args) {
        const result = await original.apply(this, args);
        await settled();
        return result;
      };
    }
  }
}

// An async (web-first) matcher resolves after its assertion; sync matchers are returned untouched.
const guardMatchers = (matchers) => new Proxy(matchers, {
  get(target, key) {
    const value = target[key];
    if (key === 'not' || key === 'resolves' || key === 'rejects') return guardMatchers(value);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const result = value.apply(target, args);
      return result && typeof result.then === 'function' ? result.then(async (outcome) => { await settled(); return outcome; }) : result;
    };
  }
});
const guardExpect = (base) => new Proxy(base, {
  apply: (target, thisArg, args) => guardMatchers(target(...args)),
  get(target, key) {
    if (key === 'soft' || key === 'poll') return (...args) => guardMatchers(target[key](...args));
    if (key === 'configure' || key === 'extend') return (...args) => guardExpect(target[key](...args));
    return target[key];
  }
});
export const expect = guardExpect(playwrightExpect);
