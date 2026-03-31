export function mockUsageUnavailable(...dimensionKeys) {
  return Object.fromEntries(dimensionKeys.map((dimensionKey) => [dimensionKey, async () => ({ status: 'unknown', reasonCode: 'mocked_unavailable' })]));
}
