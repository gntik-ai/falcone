// Temporal is the system boundary: record activity invocations and supply server metadata.
let runtime = {};
export function setRuntime(value) { runtime = value; }
export class ApplicationFailure extends Error {
  constructor(message) { super(message); this.name = 'ApplicationFailure'; }
  static nonRetryable(message, type) { return Object.assign(new ApplicationFailure(message), { type, nonRetryable: true }); }
  static retryable(message, type) { return Object.assign(new ApplicationFailure(message), { type, nonRetryable: false }); }
}
export const Context = { current: () => ({ info: runtime.activityInfo }) };
export function workflowInfo() { return runtime.workflowInfo; }
export function patched() { return runtime.patched ?? true; }
export function proxyActivities() {
  return new Proxy({}, { get: (_, name) => async (...args) => {
    runtime.calls?.push({ name, args });
    return runtime.activities[name](...args);
  } });
}
export function defineSignal(name) { return name; }
export function defineQuery(name) { return name; }
export function setHandler() {}
export async function executeChild(fn, options) { return fn(...options.args); }
export const CancellationScope = { cancellable: (fn) => fn() };
export async function condition(predicate) { return predicate(); }
export async function sleep() {}
export function evaluate() { throw new Error('CEL expressions are outside this token test'); }
