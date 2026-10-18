// Temporal is the system boundary: record activity invocations and supply server metadata.
let runtime = {};
export function setRuntime(value) { runtime = value; }
export class ApplicationFailure extends Error {
  constructor(message) { super(message); this.name = 'ApplicationFailure'; }
  static nonRetryable(message, type, ...details) { return Object.assign(new ApplicationFailure(message), { type, nonRetryable: true, details }); }
  static retryable(message, type) { return Object.assign(new ApplicationFailure(message), { type, nonRetryable: false }); }
}
export const Context = { current: () => ({ info: runtime.activityInfo }) };
export function workflowInfo() { return runtime.workflowInfo; }
export function patched(id) { return typeof runtime.patched === 'object' ? runtime.patched[id] ?? true : runtime.patched ?? true; }
export function proxyActivities(options) {
  return new Proxy({}, { get: (_, name) => async (...args) => {
    const call = { name, args, options, nonCancellable: runtime.inNonCancellable ?? false };
    runtime.calls?.push(call);
    let result;
    const began = Date.now();
    for (let attempt = 1; ; attempt++) {
      try { result = await runtime.activities[name](...args); break; }
      catch (error) {
        // Optional Temporal-server retry simulation; one scheduled command, several attempts.
        if (!runtime.retryActivities || error.nonRetryable || error.name === 'TimeoutFailure'
          || attempt >= (options.retry?.maximumAttempts ?? 1)
          || Date.now() - began >= options.scheduleToCloseTimeout) throw error;
      }
    }
    call.result = result;
    return result;
  } });
}
export function defineSignal(name) { return name; }
export function defineQuery(name) { return name; }
export function setHandler() {}
export async function executeChild(fn, options) {
  runtime.calls?.push({ name: 'executeChild', workflowId: options.workflowId, args: options.args });
  return fn(...options.args);
}
export class CancelledFailure extends Error { constructor(message = 'cancelled') { super(message); this.name = 'CancelledFailure'; } }
export class TimeoutFailure extends Error { constructor() { super('timed out'); this.name = 'TimeoutFailure'; } }
export const isCancellation = error => error?.name === 'CancelledFailure' || Boolean(error?.cause && isCancellation(error.cause));
export const ActivityCancellationType = { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' };
export const CancellationScope = {
  cancellable: fn => fn(),
  current: () => ({ get consideredCancelled() { return runtime.cancelled ?? false; } }),
  nonCancellable: async fn => {
    const before = runtime.inNonCancellable;
    runtime.inNonCancellable = true;
    try { return await fn(); } finally { runtime.inNonCancellable = before; }
  },
};
export const log = { warn: (...args) => runtime.warnings?.push(args) };
export async function condition(predicate) { return predicate(); }
export async function sleep(ms) { runtime.sleeps?.push(ms); await runtime.sleep?.(ms); }
export function evaluate() { throw new Error('CEL expressions are outside this token test'); }
