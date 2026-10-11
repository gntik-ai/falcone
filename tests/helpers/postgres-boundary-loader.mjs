export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pg') return { url: new URL('./postgres-boundary.mjs', import.meta.url).href, shortCircuit: true };
  if (['mongodb', 'kafkajs'].includes(specifier)) return { url: new URL('./unused-driver-boundary.mjs', import.meta.url).href, shortCircuit: true };
  // The production route table uses the image's /repo prefix; map only that filesystem seam.
  if (specifier.startsWith('/repo/')) return nextResolve(new URL(`../../${specifier.slice(6)}`, import.meta.url).href, context);
  return nextResolve(specifier, context);
}
