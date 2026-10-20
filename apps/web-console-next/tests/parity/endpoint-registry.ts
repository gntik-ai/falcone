import type { EndpointResponse, EndpointVariants, PageEndpoint, Role } from './manifest'

type Endpoint = { method: string; path: string }
export function createEndpointRegistry(
  shell: Record<string, Endpoint>,
  shellResponse: (name: string, variant: string, role: Role) => EndpointResponse,
  pages: Record<string, PageEndpoint> = {},
) {
  const endpoints: Record<string, Endpoint> = { ...shell }
  for (const [name, endpoint] of Object.entries(pages)) {
    if (Object.hasOwn(endpoints, name)) throw new Error(`Endpoint collision: ${name}`)
    if (Object.values(endpoints).some((value) => value.method === endpoint.method && value.path === endpoint.path)) {
      throw new Error(`Endpoint collision: ${endpoint.method} ${endpoint.path}`)
    }
    endpoints[name] = endpoint
  }
  let selected: EndpointVariants = {}
  const attempts = new Map<string, number>()
  return {
    setVariants(value: EndpointVariants) {
      for (const name of Object.keys(value)) {
        if (!Object.hasOwn(endpoints, name)) throw new Error(`Unknown endpoint: ${name}`)
        if (Array.isArray(value[name]) && !value[name].length) throw new Error(`Empty response sequence: ${name}`)
      }
      selected = value
      attempts.clear()
    },
    find(method: string, path: string) {
      return Object.keys(endpoints).find((name) => endpoints[name].method === method && endpoints[name].path === path)
    },
    responseFor(name: string, role: Role): EndpointResponse {
      const sequence = selected[name] ?? 'success'
      const attempt = attempts.get(name) ?? 0
      attempts.set(name, attempt + 1)
      const choice = Array.isArray(sequence) ? sequence[Math.min(attempt, sequence.length - 1)] : sequence
      const variant = typeof choice === 'string' ? choice : choice.variant ?? 'success'
      let response: EndpointResponse
      if (!Object.hasOwn(pages, name)) response = shellResponse(name, variant, role)
      else {
        const fixtures = pages[name].fixtures
        if (Object.hasOwn(fixtures, variant)) {
          const fixture = fixtures[variant]
          response = typeof fixture === 'function' ? fixture(role) : fixture
        } else if (variant === 'network') response = { network: true }
        else if (['401', '403', '404', '500'].includes(variant)) {
          response = { status: Number(variant), body: { code: `HTTP_${variant}`, message: 'synthetic-error' } }
        } else throw new Error(`Unknown fixture ${name} ${variant}`)
      }
      return typeof choice === 'object' && choice.delayMs !== undefined ? { ...response, delayMs: choice.delayMs } : response
    },
  }
}
