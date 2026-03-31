export function collectors(usageByDimension = {}) { return Object.fromEntries(Object.entries(usageByDimension).map(([k, v]) => [k, async () => ({ observedUsage: v })])); }
