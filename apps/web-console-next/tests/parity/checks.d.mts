// Only what TypeScript tests import; the Playwright journeys consume checks.mjs as plain JavaScript.
export function assertNoSampleData(parity: {
  page: { isClosed(): boolean; evaluate(run: (strings: string[]) => unknown, strings: string[]): Promise<unknown> }
  network?: { supplied?: string[] }
}): Promise<void>
